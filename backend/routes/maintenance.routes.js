// Stratégie de maintenance : bibliothèque AMDE (FMEA) par classe, stratégie recommandée par actif, documents de stratégie, actifs en fin de vie.
const router = require("express").Router();
const db = require("../config/db");
const { withTransaction } = db;
const { requireAuth, requireEngineerAnywhere } = require("../middleware/auth");
const { wrap, notFound, badRequest } = require("../utils/errors");
const { parse, z, optStr, optInt } = require("../utils/validate");
const { recordAudit, diff } = require("../services/audit");
const { hasRole } = require("../services/permissions");
const { scopeFor } = require("../services/scope");
const risk = require("../services/risk");
const reports = require("../services/reports");
const { sendTable } = require("../services/tabular");

const map = (r) => ({ id: r.id, classCode: r.class_code, failureMode: r.failure_mode, mechanism: r.mechanism, effect: r.effect, task: r.task, method: r.method, intervalMonths: r.interval_months, discipline: r.discipline });

const fmeaSchema = z.object({
	classCode: z.string().trim().toUpperCase().min(1).max(20), failureMode: z.string().trim().min(1).max(200), mechanism: optStr(200), effect: optStr(255),
	task: z.string().trim().min(1).max(255), method: optStr(120), intervalMonths: optInt(1, 600), discipline: optStr(80), // null = intervalle RBI
});
const toRow = (d) => [d.classCode, d.failureMode, d.mechanism ?? null, d.effect ?? null, d.task, d.method ?? null, d.intervalMonths ?? null, d.discipline ?? null];

router.get("/fmea", requireAuth, wrap(async (req, res) => {
	const [rows] = await db.query(`SELECT * FROM fmea_library ${req.query.class ? "WHERE class_code = ?" : ""} ORDER BY class_code, id`, req.query.class ? [String(req.query.class).toUpperCase()] : []);
	const items = rows.map(map);
	if (req.query.format) return sendTable(res, "fmea", ["classCode", "failureMode", "mechanism", "effect", "task", "method", "intervalMonths", "discipline"], items, req.query.format);
	res.json(items);
}));

router.post("/fmea", requireEngineerAnywhere, wrap(async (req, res) => {
	const d = parse(fmeaSchema, req.body);
	const id = await withTransaction(async (conn) => {
		const [[c]] = await conn.query("SELECT code FROM asset_classes WHERE code = ?", [d.classCode]);
		if (!c) throw badRequest("Classe inconnue");
		const [r] = await conn.query("INSERT INTO fmea_library (class_code,failure_mode,mechanism,effect,task,method,interval_months,discipline) VALUES (?,?,?,?,?,?,?,?)", toRow(d));
		await recordAudit(conn, req, { action: "create", entity: "fmea", entityId: r.insertId, label: `${d.classCode} ${d.failureMode}`, after: d });
		return r.insertId;
	});
	res.status(201).json({ id, ...d });
}));

router.put("/fmea/:id(\\d+)", requireEngineerAnywhere, wrap(async (req, res) => {
	const d = parse(fmeaSchema, req.body);
	await withTransaction(async (conn) => {
		const [[b]] = await conn.query("SELECT * FROM fmea_library WHERE id = ?", [req.params.id]);
		if (!b) throw notFound();
		await conn.query("UPDATE fmea_library SET class_code=?, failure_mode=?, mechanism=?, effect=?, task=?, method=?, interval_months=?, discipline=? WHERE id=?", [...toRow(d), req.params.id]);
		const ch = diff(map(b), { id: b.id, ...d });
		if (ch.changed) await recordAudit(conn, req, { action: "update", entity: "fmea", entityId: b.id, label: `${d.classCode} ${d.failureMode}`, ...ch });
	});
	res.json({ id: Number(req.params.id), ...d });
}));

router.delete("/fmea/:id(\\d+)", requireEngineerAnywhere, wrap(async (req, res) => {
	await withTransaction(async (conn) => {
		const [[b]] = await conn.query("SELECT * FROM fmea_library WHERE id = ?", [req.params.id]);
		if (!b) throw notFound();
		await conn.query("DELETE FROM fmea_library WHERE id = ?", [b.id]);
		await recordAudit(conn, req, { action: "delete", entity: "fmea", entityId: b.id, label: `${b.class_code} ${b.failure_mode}`, before: map(b) });
	});
	res.status(204).end();
}));

// --- Stratégie recommandée pour un actif : tâches de la bibliothèque pour sa classe, intervalle « RBI » = intervalle calculé ---
router.get("/strategy/asset/:id(\\d+)", requireAuth, wrap(async (req, res) => {
	const r = await risk.evaluateOne(db, Number(req.params.id));
	if (!r) throw notFound();
	const [[fac]] = await db.query("SELECT s.facility_id FROM assets a JOIN systems s ON s.id=a.system_id WHERE a.id=?", [r.row.id]);
	if (!hasRole(req.user, fac.facility_id, "reader")) throw notFound();
	const [rows] = await db.query("SELECT * FROM fmea_library WHERE class_code = ? ORDER BY id", [r.row.class_code]);
	res.json({
		classCode: r.row.class_code, rbiIntervalMonths: r.evaluation.intervalMonths, risk: r.evaluation.risk,
		tasks: rows.map((x) => ({ ...map(x), effectiveIntervalMonths: x.interval_months ?? r.evaluation.intervalMonths, basis: x.interval_months == null ? "rbi" : "fixed" })),
	});
}));

// --- Document de stratégie (PDF ou Word) par classe et par installation ---
router.get("/strategy-document", requireAuth, wrap(async (req, res) => {
	const q = parse(z.object({ class: z.string().max(20).optional(), facility: z.coerce.number().int().positive(), format: z.enum(["pdf", "docx"]).default("pdf") }), req.query);
	if (!hasRole(req.user, q.facility, "reader")) throw notFound();
	const [[fac]] = await db.query("SELECT name FROM facilities WHERE id = ?", [q.facility]);
	if (!fac) throw notFound();
	const cls = q.class ? q.class.toUpperCase() : null;
	const [rows] = await db.query(`SELECT * FROM fmea_library ${cls ? "WHERE class_code = ?" : ""} ORDER BY class_code, id`, cls ? [cls] : []);
	if (!rows.length) throw badRequest("Aucune ligne de stratégie pour cette sélection");
	const [assets] = await db.query("SELECT a.tag, a.class_code FROM assets a JOIN systems s ON s.id=a.system_id WHERE s.facility_id = ? AND a.archived_at IS NULL ORDER BY a.tag", [q.facility]);
	const assetsByClass = {};
	for (const a of assets) (assetsByClass[a.class_code] ||= []).push(a.tag);
	const args = { title: `${fac.name}${cls ? " — " + cls : ""}`, rows, assetsByClass, lang: req.user.locale, showWarning: process.env.SHOW_VALIDATION_WARNING !== "false" };
	const name = `strategie-${fac.name.replace(/\W+/g, "-")}${cls ? "-" + cls : ""}`;
	if (q.format === "docx") {
		res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${name}.docx"` });
		return res.send(await reports.strategyDocx(args));
	}
	res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"`, "X-Content-Type-Options": "nosniff" });
	res.send(await reports.strategyPdf(args));
}));

// --- Actifs en fin de vie à revoir : RL < seuil ou anomalie P1/P2 ouverte ---
router.get("/end-of-life", requireAuth, wrap(async (req, res) => {
	await risk.ensureFresh();
	const sc = scopeFor(req.user, "s.facility_id", "reader", req.query.facility);
	if (sc.empty) return res.json([]);
	const [rows] = await db.query(
		`SELECT a.id, a.tag, a.description, a.class_code, s.facility_id, r.remaining_life, r.risk, r.pof, r.due_date,
		        (SELECT COUNT(*) FROM anomalies n WHERE n.asset_id = a.id AND n.status <> 'Closed' AND n.priority IN ('P1','P2')) AS urgent
		 FROM assets a JOIN systems s ON s.id=a.system_id JOIN asset_risk r ON r.asset_id=a.id
		 WHERE a.archived_at IS NULL AND r.end_of_life = 1 ${sc.where.length ? "AND " + sc.where.join(" AND ") : ""} ORDER BY r.remaining_life IS NULL, r.remaining_life, a.tag`, sc.params);
	const items = rows.map((r) => ({ assetId: r.id, tag: r.tag, description: r.description, classCode: r.class_code, facilityId: r.facility_id, remainingLife: r.remaining_life, risk: r.risk, pof: r.pof, dueDate: r.due_date ? String(r.due_date).slice(0, 10) : null, urgentAnomalies: r.urgent }));
	if (req.query.format) return sendTable(res, "fin-de-vie", ["tag", "description", "classCode", "remainingLife", "risk", "urgentAnomalies", "dueDate"], items, req.query.format);
	res.json(items);
}));

module.exports = router;
