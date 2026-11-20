const router = require("express").Router();
const multer = require("multer");
const db = require("../config/db");
const { withTransaction } = db;
const engine = require("../../packages/engine");
const { requireAuth } = require("../middleware/auth");
const { wrap, notFound, forbidden, badRequest } = require("../utils/errors");
const { parse, z, optStr } = require("../utils/validate");
const { isoDate } = require("../utils/dates");
const { recordAudit, diff } = require("../services/audit");
const { hasRole } = require("../services/permissions");
const { scopeFor, facilityOfAsset } = require("../services/scope");
const { loadSettings } = require("../services/settings");
const risk = require("../services/risk");
const storage = require("../services/storage");
const reports = require("../services/reports");
const { sendTable } = require("../services/tabular");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const pj = (v) => (typeof v === "string" ? JSON.parse(v) : v);

const bodySchema = z.object({
	assetId: z.number().int().positive(),
	templateId: z.string().trim().min(1).max(20),
	performedOn: isoDate,
	inspector: optStr(120),
	data: z.record(z.string(), z.any()).default({}),
	readings: z.array(z.object({ cml: z.string().trim().min(1).max(30), t: z.coerce.number().positive().max(1000) })).max(500).optional(),
	notes: optStr(5000),
});

const mapInsp = (r) => ({
	id: r.id, reference: r.reference, assetId: r.asset_id, tag: r.tag, assetDescription: r.asset_description, classCode: r.class_code,
	facilityId: r.facility_id, templateId: r.template_id, templateName: r.template_name, performedOn: String(r.performed_on).slice(0, 10),
	inspector: r.inspector, data: pj(r.data), readings: pj(r.readings), minThickness: r.min_thickness, grade: r.grade,
	gradeReasons: pj(r.grade_reasons) ?? [], notes: r.notes, reportFileId: r.report_file_id, createdAt: r.created_at,
});
const BASE = `SELECT i.*, a.tag, a.description AS asset_description, a.class_code, s.facility_id, t.name AS template_name
	FROM inspections i JOIN assets a ON a.id = i.asset_id JOIN systems s ON s.id = a.system_id JOIN inspection_templates t ON t.id = i.template_id`;

/** Garde uniquement les champs du gabarit, avec contrôle de type ; lève une 400 sinon. */
function cleanData(template, data) {
	const out = {};
	for (const f of template.fields) {
		if (f.t === "cml") continue;
		const v = data[f.k];
		if (v === undefined || v === null || v === "") continue;
		if (f.t === "pf" && !["Pass", "Fail"].includes(v)) throw badRequest(`${f.l} : « Pass » ou « Fail » attendu`);
		if (f.t === "grade" && !(Number.isInteger(Number(v)) && v >= 1 && v <= 4)) throw badRequest(`${f.l} : grade 1 à 4`);
		if (f.t === "select" && !(f.o || []).includes(v)) throw badRequest(`${f.l} : valeur non autorisée`);
		if (f.t === "num" && !Number.isFinite(Number(v))) throw badRequest(`${f.l} : nombre attendu`);
		out[f.k] = f.t === "num" || f.t === "grade" ? Number(v) : String(v).slice(0, 5000);
	}
	return out;
}

async function getTemplate(conn, id) {
	const [[t]] = await conn.query("SELECT * FROM inspection_templates WHERE id = ?", [id]);
	if (!t) throw badRequest("Gabarit inconnu");
	return { id: t.id, name: t.name, classes: pj(t.classes), fields: pj(t.fields), rules: pj(t.rules), isActive: !!t.is_active };
}

/** Crée ou met à jour le rapport PDF d'inspection et l'enregistre au registre documentaire (nouvelle révision si le document existe). */
async function publishReport(inspectionId, userId, lang = "fr") {
	const [[row]] = await db.query(`${BASE} WHERE i.id = ?`, [inspectionId]);
	const [[asset]] = await db.query("SELECT a.*, s.name AS system_name, s.facility_id, f.name AS facility_name FROM assets a JOIN systems s ON s.id=a.system_id JOIN facilities f ON f.id=s.facility_id WHERE a.id = ?", [row.asset_id]);
	const template = await getTemplate(db, row.template_id);
	const ev = (await risk.evaluateOne(db, row.asset_id))?.evaluation;
	const settings = await loadSettings();
	const pdf = await reports.inspectionReportPdf({
		inspection: { ...row, data: pj(row.data), readings: pj(row.readings) }, asset, template, evaluation: ev, lang,
		showWarning: process.env.SHOW_VALIDATION_WARNING !== "false",
	});
	void settings;
	const file = await storage.put(pdf, { name: `${row.reference}.pdf`, mime: "application/pdf", userId });
	let [[doc]] = await db.query("SELECT id, current_revision FROM documents WHERE doc_number = ?", [row.reference]);
	let revision = "1";
	if (!doc) {
		const [r] = await db.query("INSERT INTO documents (doc_number,title,doc_type,facility_id,current_revision,created_by) VALUES (?,?,?,?,?,?)",
			[row.reference, `${row.template_name} — ${row.tag}`, "Report", asset.facility_id, revision, userId]);
		doc = { id: r.insertId };
		await db.query("INSERT IGNORE INTO document_assets (document_id, asset_id) VALUES (?,?)", [doc.id, row.asset_id]);
	} else {
		revision = String((parseInt(doc.current_revision, 10) || 0) + 1);
		await db.query("UPDATE documents SET current_revision = ? WHERE id = ?", [revision, doc.id]);
	}
	await db.query("INSERT INTO document_versions (document_id, revision, file_id, comment, uploaded_by) VALUES (?,?,?,?,?)", [doc.id, revision, file.id, "Rapport généré automatiquement", userId]);
	await db.query("UPDATE inspections SET report_file_id = ? WHERE id = ?", [file.id, inspectionId]);
}

// --- Liste / planning / détail ---
router.get("/", requireAuth, wrap(async (req, res) => {
	const q = parse(z.object({
		asset: z.coerce.number().int().optional(), facility: z.coerce.number().int().optional(), template: z.string().max(20).optional(),
		from: z.string().max(10).optional(), to: z.string().max(10).optional(), q: z.string().max(100).optional(),
		page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(200).default(50), format: z.enum(["csv", "xlsx"]).optional(),
	}), req.query);
	const sc = scopeFor(req.user, "s.facility_id", "reader", q.facility);
	if (sc.empty) return res.json({ total: 0, items: [] });
	const where = [...sc.where], params = [...sc.params];
	if (q.asset) { where.push("i.asset_id = ?"); params.push(q.asset); }
	if (q.template) { where.push("i.template_id = ?"); params.push(q.template); }
	if (q.from) { where.push("i.performed_on >= ?"); params.push(q.from); }
	if (q.to) { where.push("i.performed_on <= ?"); params.push(q.to); }
	if (q.q) { where.push("(a.tag LIKE ? OR i.reference LIKE ?)"); const l = `%${q.q.replace(/[%_\\]/g, "\\$&")}%`; params.push(l, l); }
	const w = where.length ? "WHERE " + where.join(" AND ") : "";
	if (q.format) {
		const [rows] = await db.query(`${BASE} ${w} ORDER BY i.performed_on DESC, i.id DESC LIMIT 20000`, params);
		return sendTable(res, "inspections", ["reference", "tag", "template", "performed_on", "inspector", "grade", "min_thickness_mm"],
			rows.map((r) => ({ reference: r.reference, tag: r.tag, template: r.template_name, performed_on: String(r.performed_on).slice(0, 10), inspector: r.inspector, grade: r.grade, min_thickness_mm: r.min_thickness })), q.format);
	}
	const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM inspections i JOIN assets a ON a.id=i.asset_id JOIN systems s ON s.id=a.system_id ${w}`, params);
	const [rows] = await db.query(`${BASE} ${w} ORDER BY i.performed_on DESC, i.id DESC LIMIT ? OFFSET ?`, [...params, q.limit, (q.page - 1) * q.limit]);
	res.json({ total, items: rows.map(mapInsp) });
}));

// Planning : échéances calculées par le RBI (En retard / Dû sous 90 j / Planifié).
router.get("/schedule", requireAuth, wrap(async (req, res) => {
	await risk.ensureFresh();
	const q = parse(z.object({
		facility: z.coerce.number().int().optional(), status: z.enum(["overdue", "due_soon", "planned", "unknown"]).optional(), q: z.string().max(100).optional(),
		class: z.string().max(20).optional(), discipline: z.string().max(40).optional(), format: z.enum(["csv", "xlsx"]).optional(), limit: z.coerce.number().int().min(1).max(1000).default(500),
	}), req.query);
	const sc = scopeFor(req.user, "s.facility_id", "reader", q.facility);
	if (sc.empty) return res.json([]);
	const where = ["a.archived_at IS NULL", ...sc.where], params = [...sc.params];
	if (q.discipline) { where.push("a.discipline = ?"); params.push(q.discipline); }
	if (q.status) { where.push("r.schedule_status = ?"); params.push(q.status); }
	if (q.class) { where.push("a.class_code = ?"); params.push(q.class); }
	if (q.q) { where.push("(a.tag LIKE ? OR a.description LIKE ?)"); const l = `%${q.q.replace(/[%_\\]/g, "\\$&")}%`; params.push(l, l); }
	const [rows] = await db.query(
		`SELECT a.id, a.tag, a.description, a.class_code, s.facility_id, s.code AS system_code, r.risk, r.pof, r.cof, r.criticality, r.due_date, r.days_to_due, r.schedule_status, r.interval_months, r.base_date
		 FROM assets a JOIN systems s ON s.id=a.system_id JOIN asset_risk r ON r.asset_id=a.id WHERE ${where.join(" AND ")}
		 ORDER BY r.due_date IS NULL, r.due_date, a.tag LIMIT ?`, [...params, q.limit]);
	const items = rows.map((r) => ({ assetId: r.id, tag: r.tag, description: r.description, classCode: r.class_code, facilityId: r.facility_id, systemCode: r.system_code, risk: r.risk, pof: r.pof, cof: r.cof,
		criticality: r.criticality, dueDate: r.due_date ? String(r.due_date).slice(0, 10) : null, daysToDue: r.days_to_due, status: r.schedule_status, intervalMonths: r.interval_months, baseDate: r.base_date ? String(r.base_date).slice(0, 10) : null }));
	if (q.format) return sendTable(res, "planning-inspections", ["tag", "description", "classCode", "systemCode", "risk", "dueDate", "daysToDue", "status", "intervalMonths"], items, q.format);
	res.json(items);
}));

router.get("/templates", requireAuth, wrap(async (_req, res) => {
	const [rows] = await db.query("SELECT * FROM inspection_templates ORDER BY id");
	res.json(rows.map((t) => ({ id: t.id, name: t.name, classes: pj(t.classes), fields: pj(t.fields), rules: pj(t.rules), isActive: !!t.is_active })));
}));

router.get("/:id(\\d+)", requireAuth, wrap(async (req, res) => {
	const [[r]] = await db.query(`${BASE} WHERE i.id = ?`, [req.params.id]);
	if (!r || !hasRole(req.user, r.facility_id, "reader")) throw notFound();
	const [att] = await db.query("SELECT f.id, f.original_name AS name, f.mime, f.size_bytes AS size FROM inspection_attachments ia JOIN files f ON f.id = ia.file_id WHERE ia.inspection_id = ?", [r.id]);
	res.json({ ...mapInsp(r), attachments: att });
}));

router.get("/:id(\\d+)/report", requireAuth, wrap(async (req, res) => {
	const [[r]] = await db.query(`${BASE} WHERE i.id = ?`, [req.params.id]);
	if (!r || !hasRole(req.user, r.facility_id, "reader")) throw notFound();
	const [[asset]] = await db.query("SELECT a.*, s.name AS system_name, f.name AS facility_name FROM assets a JOIN systems s ON s.id=a.system_id JOIN facilities f ON f.id=s.facility_id WHERE a.id = ?", [r.asset_id]);
	const ev = (await risk.evaluateOne(db, r.asset_id))?.evaluation;
	const pdf = await reports.inspectionReportPdf({ inspection: { ...r, data: pj(r.data), readings: pj(r.readings) }, asset, template: await getTemplate(db, r.template_id), evaluation: ev, lang: req.user.locale, showWarning: process.env.SHOW_VALIDATION_WARNING !== "false" });
	res.set({ "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${r.reference}.pdf"`, "X-Content-Type-Options": "nosniff" });
	res.send(pdf);
}));

// --- Saisie ---
async function prepare(conn, d, existingId = null) {
	const facilityId = await facilityOfAsset(d.assetId, conn);
	if (facilityId == null) throw badRequest("Actif inconnu");
	const template = await getTemplate(conn, d.templateId);
	const [[asset]] = await conn.query("SELECT class_code, archived_at FROM assets WHERE id = ?", [d.assetId]);
	if (asset.archived_at) throw badRequest("Actif archivé");
	if (!template.isActive || !template.classes.includes(asset.class_code)) throw badRequest("Ce gabarit ne s'applique pas à la classe de cet actif");
	const hasCml = template.fields.some((f) => f.t === "cml");
	const readings = hasCml ? (d.readings || []) : null;
	if (hasCml && !readings.length) throw badRequest("Au moins un relevé d'épaisseur est requis");
	const data = cleanData(template, d.data);
	const g = engine.computeGrade(template, data);
	void existingId;
	return { facilityId, template, readings, data, grade: g.grade, reasons: g.reasons, minThickness: hasCml ? engine.governingThickness(readings) : null };
}

router.post("/", requireAuth, wrap(async (req, res) => {
	const d = parse(bodySchema, req.body);
	const out = await withTransaction(async (conn) => {
		const p = await prepare(conn, d);
		if (!hasRole(req.user, p.facilityId, "inspector")) throw forbidden();
		const [ins] = await conn.query(
			`INSERT INTO inspections (reference, asset_id, template_id, performed_on, inspector, data, readings, min_thickness, grade, grade_reasons, notes, created_by)
			 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
			[`TMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, d.assetId, d.templateId, d.performedOn, d.inspector ?? req.user.fullName, JSON.stringify(p.data),
				p.readings ? JSON.stringify(p.readings) : null, p.minThickness, p.grade, JSON.stringify(p.reasons), d.notes ?? null, req.user.id]);
		const reference = `IR-${String(ins.insertId).padStart(5, "0")}`;
		await conn.query("UPDATE inspections SET reference = ? WHERE id = ?", [reference, ins.insertId]);
		const results = await risk.recompute(conn, [d.assetId]);
		const evaluation = results.get(d.assetId);
		const settings = await loadSettings(conn);
		const suggestion = engine.suggestAnomaly({ evalResult: evaluation, grade: p.grade }, settings.engine);
		const [[asset]] = await conn.query("SELECT tag FROM assets WHERE id = ?", [d.assetId]);
		await recordAudit(conn, req, { action: "create", entity: "inspection", entityId: ins.insertId, label: `${reference} ${asset.tag}`, facilityId: p.facilityId,
			after: { reference, tag: asset.tag, templateId: d.templateId, performedOn: d.performedOn, grade: p.grade, minThickness: p.minThickness, readings: p.readings, data: p.data } });
		return { id: ins.insertId, reference, evaluation, suggestion, grade: p.grade, gradeReasons: p.reasons };
	});
	publishReport(out.id, req.user.id, req.user.locale).catch((e) => console.error("Rapport d'inspection non généré :", e.message));
	res.status(201).json({ ...out, evaluation: { pof: out.evaluation.pof, cof: out.evaluation.cof, risk: out.evaluation.risk, rl: out.evaluation.rl ?? null, tmin: out.evaluation.tmin ?? null, dueDate: out.evaluation.dueDate, status: out.evaluation.status } });
}));

// Correction d'un résultat (donnée d'intégrité : journalisée avant/après).
router.put("/:id(\\d+)", requireAuth, wrap(async (req, res) => {
	const id = Number(req.params.id);
	const d = parse(bodySchema.omit({ assetId: true, templateId: true }), req.body);
	const out = await withTransaction(async (conn) => {
		const [[row]] = await conn.query(`${BASE} WHERE i.id = ?`, [id]);
		if (!row) throw notFound();
		if (!hasRole(req.user, row.facility_id, "engineer")) throw forbidden();
		const p = await prepare(conn, { ...d, assetId: row.asset_id, templateId: row.template_id }, id);
		const before = { performedOn: String(row.performed_on).slice(0, 10), inspector: row.inspector, grade: row.grade, minThickness: row.min_thickness, readings: pj(row.readings), data: pj(row.data), notes: row.notes };
		const after = { performedOn: d.performedOn, inspector: d.inspector ?? row.inspector, grade: p.grade, minThickness: p.minThickness, readings: p.readings, data: p.data, notes: d.notes ?? null };
		await conn.query("UPDATE inspections SET performed_on=?, inspector=?, data=?, readings=?, min_thickness=?, grade=?, grade_reasons=?, notes=? WHERE id=?",
			[after.performedOn, after.inspector, JSON.stringify(p.data), p.readings ? JSON.stringify(p.readings) : null, p.minThickness, p.grade, JSON.stringify(p.reasons), after.notes, id]);
		const results = await risk.recompute(conn, [row.asset_id]);
		const ch = diff(before, after);
		if (ch.changed) await recordAudit(conn, req, { action: "update", entity: "inspection", entityId: id, label: `${row.reference} ${row.tag}`, facilityId: row.facility_id, ...ch });
		return { evaluation: results.get(row.asset_id), grade: p.grade };
	});
	publishReport(id, req.user.id, req.user.locale).catch((e) => console.error("Rapport non régénéré :", e.message));
	res.json({ grade: out.grade, evaluation: { pof: out.evaluation.pof, risk: out.evaluation.risk, dueDate: out.evaluation.dueDate } });
}));

// --- Pièces jointes ---
router.post("/:id(\\d+)/attachments", requireAuth, upload.single("file"), wrap(async (req, res) => {
	if (!req.file) throw badRequest("Fichier manquant");
	const [[r]] = await db.query(`${BASE} WHERE i.id = ?`, [req.params.id]);
	if (!r) throw notFound();
	if (!hasRole(req.user, r.facility_id, "inspector")) throw forbidden();
	const mime = storage.sniff(req.file.buffer, req.file.originalname);
	if (!mime) throw badRequest("Type de fichier non accepté (PDF, PNG, JPEG, WebP, DOCX, XLSX)");
	const f = await storage.put(req.file.buffer, { name: req.file.originalname, mime, userId: req.user.id });
	await db.query("INSERT INTO inspection_attachments (inspection_id, file_id) VALUES (?,?)", [r.id, f.id]);
	await recordAudit(null, req, { action: "attach", entity: "inspection", entityId: r.id, label: `${r.reference} ${r.tag}`, facilityId: r.facility_id, after: { file: f.name, sha256: f.sha256 } });
	res.status(201).json({ id: f.id, name: f.name, mime: f.mime, size: f.size });
}));

module.exports = router;
module.exports.publishReport = publishReport;
