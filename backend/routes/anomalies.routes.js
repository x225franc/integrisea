const router = require("express").Router();
const db = require("../config/db");
const { withTransaction } = db;
const engine = require("../../packages/engine");
const { requireAuth } = require("../middleware/auth");
const { wrap, notFound, forbidden, badRequest, conflict } = require("../utils/errors");
const { parse, z, optStr } = require("../utils/validate");
const { isoDate } = require("../utils/dates");
const { recordAudit, diff } = require("../services/audit");
const { hasRole } = require("../services/permissions");
const { scopeFor, facilityOfAsset } = require("../services/scope");
const { loadSettings } = require("../services/settings");
const risk = require("../services/risk");
const { sendTable } = require("../services/tabular");

const STATUS = z.enum(["Open", "InProgress", "Closed"]);
const PRIORITY = z.enum(["P1", "P2", "P3", "P4"]);
const d10 = (v) => (v ? String(v).slice(0, 10) : null);

const BASE = `SELECT n.*, a.tag, a.description AS asset_description, a.class_code, s.facility_id
	FROM anomalies n JOIN assets a ON a.id = n.asset_id JOIN systems s ON s.id = a.system_id`;

const mapAn = (r, today) => ({
	id: r.id, reference: r.reference, assetId: r.asset_id, tag: r.tag, assetDescription: r.asset_description, classCode: r.class_code, facilityId: r.facility_id,
	title: r.title, description: r.description, priority: r.priority, status: r.status, owner: r.owner, raisedOn: d10(r.raised_on), dueDate: d10(r.due_date),
	closedOn: d10(r.closed_on), sourceInspectionId: r.source_inspection_id, overdue: engine.isOverdue({ status: r.status === "Closed" ? "Closed" : "Open", dueDate: d10(r.due_date) }, today),
});

async function loadFull(conn, id) {
	const [[r]] = await conn.query(`${BASE} WHERE n.id = ?`, [id]);
	if (!r) return null;
	const [actions] = await conn.query("SELECT id, action_text AS text, owner, due_date AS dueDate, done, done_on AS doneOn FROM anomaly_actions WHERE anomaly_id = ? ORDER BY id", [id]);
	const [repairs] = await conn.query("SELECT id, repair_type AS type, installed_on AS installedOn, expires_on AS expiresOn, notes, removed_on AS removedOn FROM temporary_repairs WHERE anomaly_id = ? ORDER BY id", [id]);
	return { ...mapAn(r, engine.today()), actions: actions.map((a) => ({ ...a, done: !!a.done, dueDate: d10(a.dueDate), doneOn: d10(a.doneOn) })), repairs: repairs.map((x) => ({ ...x, installedOn: d10(x.installedOn), expiresOn: d10(x.expiresOn), removedOn: d10(x.removedOn) })) };
}

const snap = (a) => ({ reference: a.reference, tag: a.tag, title: a.title, priority: a.priority, status: a.status, owner: a.owner, dueDate: a.dueDate, closedOn: a.closedOn });

// --- Liste ---
router.get("/", requireAuth, wrap(async (req, res) => {
	const q = parse(z.object({
		status: z.enum(["open", "Open", "InProgress", "Closed", "all"]).default("open"), priority: PRIORITY.optional(), facility: z.coerce.number().int().optional(),
		asset: z.coerce.number().int().optional(), q: z.string().max(100).optional(), overdue: z.enum(["1"]).optional(), discipline: z.string().max(40).optional(),
		page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(200).default(50), format: z.enum(["csv", "xlsx"]).optional(),
	}), req.query);
	const sc = scopeFor(req.user, "s.facility_id", "reader", q.facility);
	if (sc.empty) return res.json({ total: 0, items: [] });
	const where = [...sc.where], params = [...sc.params];
	if (q.status === "open") where.push("n.status <> 'Closed'"); else if (q.status !== "all") { where.push("n.status = ?"); params.push(q.status); }
	if (q.priority) { where.push("n.priority = ?"); params.push(q.priority); }
	if (q.asset) { where.push("n.asset_id = ?"); params.push(q.asset); }
	if (q.discipline) { where.push("a.discipline = ?"); params.push(q.discipline); }
	if (q.overdue) { where.push("n.status <> 'Closed' AND n.due_date < ?"); params.push(engine.today()); }
	if (q.q) { where.push("(a.tag LIKE ? OR n.title LIKE ? OR n.reference LIKE ?)"); const l = `%${q.q.replace(/[%_\\]/g, "\\$&")}%`; params.push(l, l, l); }
	const w = where.length ? "WHERE " + where.join(" AND ") : "";
	const order = "ORDER BY FIELD(n.priority,'P1','P2','P3','P4'), n.due_date";
	const today = engine.today();
	if (q.format) {
		const [rows] = await db.query(`${BASE} ${w} ${order} LIMIT 20000`, params);
		return sendTable(res, "anomalies", ["reference", "tag", "title", "priority", "status", "owner", "raisedOn", "dueDate", "closedOn", "overdue"], rows.map((r) => mapAn(r, today)), q.format);
	}
	const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM anomalies n JOIN assets a ON a.id=n.asset_id JOIN systems s ON s.id=a.system_id ${w}`, params);
	const [rows] = await db.query(`${BASE} ${w} ${order} LIMIT ? OFFSET ?`, [...params, q.limit, (q.page - 1) * q.limit]);
	res.json({ total, items: rows.map((r) => mapAn(r, today)) });
}));

// Registre des réparations temporaires, avec alertes avant expiration.
router.get("/repairs", requireAuth, wrap(async (req, res) => {
	const sc = scopeFor(req.user, "s.facility_id", "reader", req.query.facility);
	if (sc.empty) return res.json([]);
	const where = ["t.removed_on IS NULL", ...sc.where];
	const [rows] = await db.query(
		`SELECT t.id, t.repair_type, t.installed_on, t.expires_on, t.notes, n.id AS anomaly_id, n.reference, n.priority, a.tag, s.facility_id
		 FROM temporary_repairs t JOIN anomalies n ON n.id = t.anomaly_id JOIN assets a ON a.id = n.asset_id JOIN systems s ON s.id = a.system_id
		 WHERE ${where.join(" AND ")} ORDER BY t.expires_on`, sc.params);
	const settings = await loadSettings();
	const today = engine.today();
	const items = rows.map((r) => ({ id: r.id, type: r.repair_type, installedOn: d10(r.installed_on), expiresOn: d10(r.expires_on), notes: r.notes, anomalyId: r.anomaly_id, reference: r.reference,
		priority: r.priority, tag: r.tag, facilityId: r.facility_id, ...engine.repairStatus(d10(r.expires_on), today, settings.engine) }));
	if (req.query.format) return sendTable(res, "reparations-temporaires", ["tag", "reference", "type", "installedOn", "expiresOn", "daysLeft", "status"], items, req.query.format);
	res.json(items);
}));

router.get("/:id(\\d+)", requireAuth, wrap(async (req, res) => {
	const a = await loadFull(db, req.params.id);
	if (!a || !hasRole(req.user, a.facilityId, "reader")) throw notFound();
	res.json(a);
}));

// --- Création (inspecteur ou ingénieur) ---
const actionSchema = z.object({ text: z.string().trim().min(1).max(500), owner: optStr(120), dueDate: isoDate.nullable().optional() });
const repairSchema = z.object({ type: z.string().trim().min(1).max(120), installedOn: isoDate.nullable().optional(), expiresOn: isoDate, notes: optStr(500) });
const createSchema = z.object({
	assetId: z.number().int().positive(), title: z.string().trim().min(1).max(255), description: optStr(5000), priority: PRIORITY,
	owner: optStr(120), raisedOn: isoDate.optional(), sourceInspectionId: z.number().int().positive().nullable().optional(),
	actions: z.array(actionSchema).max(50).default([]), repair: repairSchema.nullable().optional(),
});

router.post("/", requireAuth, wrap(async (req, res) => {
	const d = parse(createSchema, req.body);
	const out = await withTransaction(async (conn) => {
		const facilityId = await facilityOfAsset(d.assetId, conn);
		if (facilityId == null) throw badRequest("Actif inconnu");
		if (!hasRole(req.user, facilityId, "inspector")) throw forbidden();
		const settings = await loadSettings(conn);
		const raisedOn = d.raisedOn ?? engine.today();
		const dueDate = engine.targetDate(d.priority, raisedOn, settings.engine);
		const [r] = await conn.query(
			`INSERT INTO anomalies (reference, asset_id, title, description, priority, owner, raised_on, due_date, source_inspection_id, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`,
			[`TMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, d.assetId, d.title, d.description ?? null, d.priority, d.owner ?? null, raisedOn, dueDate, d.sourceInspectionId ?? null, req.user.id]);
		const reference = `AN-${String(r.insertId).padStart(4, "0")}`;
		await conn.query("UPDATE anomalies SET reference = ? WHERE id = ?", [reference, r.insertId]);
		for (const a of d.actions) await conn.query("INSERT INTO anomaly_actions (anomaly_id, action_text, owner, due_date) VALUES (?,?,?,?)", [r.insertId, a.text, a.owner ?? null, a.dueDate ?? null]);
		if (d.repair) await conn.query("INSERT INTO temporary_repairs (anomaly_id, repair_type, installed_on, expires_on, notes) VALUES (?,?,?,?,?)", [r.insertId, d.repair.type, d.repair.installedOn ?? null, d.repair.expiresOn, d.repair.notes ?? null]);
		await risk.recompute(conn, [d.assetId]);
		const full = await loadFull(conn, r.insertId);
		await recordAudit(conn, req, { action: "create", entity: "anomaly", entityId: r.insertId, label: `${reference} ${full.tag}`, facilityId, after: { ...snap(full), actions: full.actions.length, repair: full.repairs[0] ?? null } });
		return full;
	});
	res.status(201).json(out);
}));

// --- Modification (ingénieur). Un changement de priorité recalcule l'échéance depuis la date de détection. ---
router.put("/:id(\\d+)", requireAuth, wrap(async (req, res) => {
	const id = Number(req.params.id);
	const d = parse(z.object({ title: z.string().trim().min(1).max(255).optional(), description: optStr(5000), priority: PRIORITY.optional(), owner: optStr(120), dueDate: isoDate.optional() }), req.body);
	const out = await withTransaction(async (conn) => {
		const before = await loadFull(conn, id);
		if (!before) throw notFound();
		if (!hasRole(req.user, before.facilityId, "engineer")) throw forbidden();
		if (before.status === "Closed") throw conflict("Anomalie clôturée : non modifiable");
		const settings = await loadSettings(conn);
		const priority = d.priority ?? before.priority;
		const dueDate = d.dueDate ?? (d.priority && d.priority !== before.priority ? engine.targetDate(priority, before.raisedOn, settings.engine) : before.dueDate);
		await conn.query("UPDATE anomalies SET title=?, description=?, priority=?, owner=?, due_date=? WHERE id=?",
			[d.title ?? before.title, "description" in d ? d.description ?? null : before.description, priority, "owner" in d ? d.owner ?? null : before.owner, dueDate, id]);
		await risk.recompute(conn, [before.assetId]);
		const after = await loadFull(conn, id);
		const ch = diff(snap(before), snap(after));
		if (ch.changed) await recordAudit(conn, req, { action: "update", entity: "anomaly", entityId: id, label: `${before.reference} ${before.tag}`, facilityId: before.facilityId, ...ch });
		return after;
	});
	res.json(out);
}));

// --- Statut : la clôture exige que toutes les actions soient terminées ---
router.post("/:id(\\d+)/status", requireAuth, wrap(async (req, res) => {
	const id = Number(req.params.id);
	const { status } = parse(z.object({ status: STATUS }), req.body);
	const out = await withTransaction(async (conn) => {
		const before = await loadFull(conn, id);
		if (!before) throw notFound();
		if (!hasRole(req.user, before.facilityId, "engineer")) throw forbidden();
		if (status === "Closed") {
			const c = engine.canClose(before.actions);
			if (!c.ok) throw conflict(`Clôture impossible : ${c.openCount} action(s) non terminée(s)`, { openActions: c.openCount });
		}
		await conn.query("UPDATE anomalies SET status = ?, closed_on = ? WHERE id = ?", [status, status === "Closed" ? engine.today() : null, id]);
		await risk.recompute(conn, [before.assetId]);
		const after = await loadFull(conn, id);
		await recordAudit(conn, req, { action: "status", entity: "anomaly", entityId: id, label: `${before.reference} ${before.tag}`, facilityId: before.facilityId, before: { status: before.status }, after: { status } });
		return after;
	});
	res.json(out);
}));

// --- Plan d'actions ---
async function withAnomaly(req, id, minRole, fn) {
	return withTransaction(async (conn) => {
		const a = await loadFull(conn, id);
		if (!a) throw notFound();
		if (!hasRole(req.user, a.facilityId, minRole)) throw forbidden();
		if (a.status === "Closed") throw conflict("Anomalie clôturée : non modifiable");
		await fn(conn, a);
		const after = await loadFull(conn, id);
		await recordAudit(conn, req, { action: "update", entity: "anomaly", entityId: id, label: `${a.reference} ${a.tag}`, facilityId: a.facilityId, before: { actions: a.actions, repairs: a.repairs }, after: { actions: after.actions, repairs: after.repairs } });
		return after;
	});
}

router.post("/:id(\\d+)/actions", requireAuth, wrap(async (req, res) => {
	const d = parse(actionSchema, req.body);
	res.status(201).json(await withAnomaly(req, Number(req.params.id), "inspector", (conn, a) =>
		conn.query("INSERT INTO anomaly_actions (anomaly_id, action_text, owner, due_date) VALUES (?,?,?,?)", [a.id, d.text, d.owner ?? null, d.dueDate ?? null])));
}));

router.put("/:id(\\d+)/actions/:aid(\\d+)", requireAuth, wrap(async (req, res) => {
	const d = parse(z.object({ done: z.boolean().optional(), text: z.string().trim().min(1).max(500).optional(), owner: optStr(120), dueDate: isoDate.nullable().optional() }), req.body);
	res.json(await withAnomaly(req, Number(req.params.id), "inspector", async (conn, a) => {
		const cur = a.actions.find((x) => x.id === Number(req.params.aid));
		if (!cur) throw notFound("Action introuvable");
		const done = d.done ?? cur.done;
		await conn.query("UPDATE anomaly_actions SET action_text=?, owner=?, due_date=?, done=?, done_on=? WHERE id=?",
			[d.text ?? cur.text, "owner" in d ? d.owner ?? null : cur.owner, "dueDate" in d ? d.dueDate ?? null : cur.dueDate, done ? 1 : 0, done ? (cur.doneOn ?? engine.today()) : null, cur.id]);
	}));
}));

router.delete("/:id(\\d+)/actions/:aid(\\d+)", requireAuth, wrap(async (req, res) => {
	res.json(await withAnomaly(req, Number(req.params.id), "engineer", (conn, a) => {
		if (!a.actions.some((x) => x.id === Number(req.params.aid))) throw notFound("Action introuvable");
		return conn.query("DELETE FROM anomaly_actions WHERE id = ?", [req.params.aid]);
	}));
}));

// --- Réparations temporaires ---
router.post("/:id(\\d+)/repairs", requireAuth, wrap(async (req, res) => {
	const d = parse(repairSchema, req.body);
	res.status(201).json(await withAnomaly(req, Number(req.params.id), "engineer", (conn, a) =>
		conn.query("INSERT INTO temporary_repairs (anomaly_id, repair_type, installed_on, expires_on, notes) VALUES (?,?,?,?,?)", [a.id, d.type, d.installedOn ?? null, d.expiresOn, d.notes ?? null])));
}));

router.put("/:id(\\d+)/repairs/:rid(\\d+)", requireAuth, wrap(async (req, res) => {
	const d = parse(z.object({ expiresOn: isoDate.optional(), removed: z.boolean().optional(), notes: optStr(500) }), req.body);
	res.json(await withAnomaly(req, Number(req.params.id), "engineer", async (conn, a) => {
		const cur = a.repairs.find((x) => x.id === Number(req.params.rid));
		if (!cur) throw notFound("Réparation introuvable");
		await conn.query("UPDATE temporary_repairs SET expires_on=?, notes=?, removed_on=? WHERE id=?",
			[d.expiresOn ?? cur.expiresOn, "notes" in d ? d.notes ?? null : cur.notes, d.removed === undefined ? cur.removedOn : d.removed ? engine.today() : null, cur.id]);
	}));
}));

module.exports = router;
