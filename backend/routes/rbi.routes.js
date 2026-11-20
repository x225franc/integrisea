// RBI, criticité et tableau de bord : lecture du cache asset_risk (recalculé par le moteur) et détail d'un calcul.
const router = require("express").Router();
const db = require("../config/db");
const engine = require("../../packages/engine");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { wrap, notFound } = require("../utils/errors");
const { parse, z } = require("../utils/validate");
const { hasRole } = require("../services/permissions");
const { scopeFor } = require("../services/scope");
const { loadSettings } = require("../services/settings");
const risk = require("../services/risk");
const { sendTable } = require("../services/tabular");

const d10 = (v) => (v ? String(v).slice(0, 10) : null);
const like = (s) => `%${s.replace(/[%_\\]/g, "\\$&")}%`;

const listQuery = z.object({
	facility: z.coerce.number().int().optional(), q: z.string().max(100).optional(), class: z.string().max(20).optional(), discipline: z.string().max(40).optional(),
	pof: z.coerce.number().int().min(1).max(5).optional(), cof: z.coerce.number().int().min(1).max(5).optional(),
	risk: z.enum(["L", "M", "MH", "H"]).optional(), criticality: z.enum(["A", "B", "C"]).optional(), status: z.enum(["overdue", "due_soon", "planned", "unknown"]).optional(),
	notCalculable: z.enum(["1"]).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(500).default(100),
	format: z.enum(["csv", "xlsx"]).optional(),
});

function filters(req, q) {
	const sc = scopeFor(req.user, "s.facility_id", "reader", q.facility);
	if (sc.empty) return null;
	const where = ["a.archived_at IS NULL", ...sc.where], params = [...sc.params];
	const add = (cond, v) => { where.push(cond); params.push(v); };
	if (q.class) add("a.class_code = ?", q.class);
	if (q.discipline) add("a.discipline = ?", q.discipline);
	if (q.pof) add("r.pof = ?", q.pof);
	if (q.cof) add("r.cof = ?", q.cof);
	if (q.risk) add("r.risk = ?", q.risk);
	if (q.criticality) add("r.criticality = ?", q.criticality);
	if (q.status) add("r.schedule_status = ?", q.status);
	if (q.notCalculable) where.push("r.calculable = 0");
	if (q.q) { where.push("(a.tag LIKE ? OR a.description LIKE ?)"); params.push(like(q.q), like(q.q)); }
	return { where: where.join(" AND "), params };
}

const FROM = "FROM assets a JOIN systems s ON s.id=a.system_id JOIN asset_risk r ON r.asset_id=a.id";
const mapRow = (r) => ({
	assetId: r.id, tag: r.tag, description: r.description, classCode: r.class_code, systemCode: r.system_code, facilityId: r.facility_id, pof: r.pof, cof: r.cof, risk: r.risk,
	criticality: r.criticality, sce: !!r.sce, tmin: r.tmin, tLast: r.t_last, corrosionRate: r.corrosion_rate, remainingLife: r.remaining_life, intervalMonths: r.interval_months,
	dueDate: d10(r.due_date), daysToDue: r.days_to_due, status: r.schedule_status, calculable: !!r.calculable, tracking: r.tracking,
});
const SEL = `SELECT a.id, a.tag, a.description, a.class_code, s.code AS system_code, s.facility_id, r.pof, r.cof, r.risk, r.criticality, r.sce, r.tmin, r.t_last, r.corrosion_rate,
	r.remaining_life, r.interval_months, r.due_date, r.days_to_due, r.schedule_status, r.calculable, r.tracking`;

// --- Liste RBI (le clic sur une case de la matrice filtre ici par pof + cof) ---
router.get("/assets", requireAuth, wrap(async (req, res) => {
	await risk.ensureFresh();
	const q = parse(listQuery, req.query);
	const f = filters(req, q);
	if (!f) return res.json({ total: 0, items: [] });
	if (q.format) {
		const [rows] = await db.query(`${SEL} ${FROM} WHERE ${f.where} ORDER BY r.risk = 'H' DESC, r.pof DESC, r.cof DESC, a.tag LIMIT 20000`, f.params);
		return sendTable(res, "rbi", ["tag", "description", "classCode", "systemCode", "pof", "cof", "risk", "criticality", "remainingLife", "intervalMonths", "dueDate", "status"], rows.map(mapRow), q.format);
	}
	const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total ${FROM} WHERE ${f.where}`, f.params);
	const [rows] = await db.query(`${SEL} ${FROM} WHERE ${f.where} ORDER BY FIELD(r.risk,'H','MH','M','L'), r.pof DESC, r.cof DESC, a.tag LIMIT ? OFFSET ?`, [...f.params, q.limit, (q.page - 1) * q.limit]);
	res.json({ total, items: rows.map(mapRow) });
}));

// --- Matrice : nombre d'actifs par case ---
router.get("/matrix", requireAuth, wrap(async (req, res) => {
	await risk.ensureFresh();
	const q = parse(listQuery.pick({ facility: true, q: true, discipline: true }), req.query);
	const f = filters(req, q);
	const settings = await loadSettings();
	let counts = {};
	if (f) {
		const [rows] = await db.query(`SELECT r.pof, r.cof, COUNT(*) AS n ${FROM} WHERE ${f.where} GROUP BY r.pof, r.cof`, f.params);
		counts = Object.fromEntries(rows.map((r) => [`${r.pof}-${r.cof}`, r.n]));
	}
	res.json({ matrix: settings.engine.matrix, counts, scales: settings.consequenceScales });
}));

// --- Détail du calcul d'un actif (ligne par ligne) : recalculé à la volée, jamais figé ---
router.get("/assets/:id(\\d+)", requireAuth, wrap(async (req, res) => {
	const r = await risk.evaluateOne(db, Number(req.params.id));
	if (!r) throw notFound();
	const [[fac]] = await db.query("SELECT s.facility_id FROM assets a JOIN systems s ON s.id=a.system_id WHERE a.id=?", [r.row.id]);
	if (!hasRole(req.user, fac.facility_id, "reader")) throw notFound();
	const settings = await loadSettings();
	res.json({
		evaluation: r.evaluation, crit: r.input.asset.crit,
		critSource: { s: r.row.crit_s != null ? "asset" : "default", e: r.row.crit_e != null ? "asset" : "default", p: r.row.crit_p != null ? "asset" : "default" },
		matrix: settings.engine.matrix, intervals: settings.engine.intervals, scales: settings.consequenceScales,
		engineVersion: engine.ENGINE_VERSION,
	});
}));

// --- Criticité : synthèse par système fonctionnel ---
router.get("/criticality", requireAuth, wrap(async (req, res) => {
	await risk.ensureFresh();
	const q = parse(listQuery.pick({ facility: true }), req.query);
	const sc = scopeFor(req.user, "s.facility_id", "reader", q.facility);
	if (sc.empty) return res.json([]);
	const where = ["a.archived_at IS NULL", ...sc.where];
	const [rows] = await db.query(
		`SELECT s.id, s.code, s.name, s.facility_id, COUNT(*) AS assets, SUM(r.criticality='A') AS a, SUM(r.criticality='B') AS b, SUM(r.criticality='C') AS c,
		        SUM(r.sce) AS sce, MAX(r.cof) AS max_cof
		 FROM assets a JOIN systems s ON s.id=a.system_id JOIN asset_risk r ON r.asset_id=a.id WHERE ${where.join(" AND ")} GROUP BY s.id ORDER BY s.code`, sc.params);
	const out = rows.map((r) => ({ systemId: r.id, code: r.code, name: r.name, facilityId: r.facility_id, assets: r.assets, a: +r.a, b: +r.b, c: +r.c, sce: +r.sce, maxCof: r.max_cof }));
	if (req.query.format) return sendTable(res, "criticite-systemes", ["code", "name", "assets", "a", "b", "c", "sce", "maxCof"], out, req.query.format);
	res.json(out);
}));

// --- Tableau de bord ---
router.get("/dashboard", requireAuth, wrap(async (req, res) => {
	await risk.ensureFresh();
	const q = parse(listQuery.pick({ facility: true, q: true, discipline: true }), req.query);
	const settings = await loadSettings();
	const empty = { kpis: { assets: 0, criticalA: 0, overdue: 0, dueSoon: 0, openAnomalies: 0, p1p2: 0, highRisk: 0, notCalculable: 0 }, matrix: settings.engine.matrix, counts: {}, anomaliesByPriority: { P1: 0, P2: 0, P3: 0, P4: 0 }, repairs: [], lowestLife: [], nextInspections: [] };
	const f = filters(req, q);
	if (!f) return res.json(empty);

	const [[k]] = await db.query(
		`SELECT COUNT(*) AS assets, SUM(r.criticality='A') AS a, SUM(r.schedule_status='overdue') AS overdue, SUM(r.schedule_status='due_soon') AS due_soon,
		        SUM(r.risk='H') AS high, SUM(r.calculable=0) AS nc ${FROM} WHERE ${f.where}`, f.params);
	const [cells] = await db.query(`SELECT r.pof, r.cof, COUNT(*) AS n ${FROM} WHERE ${f.where} GROUP BY r.pof, r.cof`, f.params);

	// Anomalies ouvertes des actifs visibles
	const [an] = await db.query(`SELECT n.priority, COUNT(*) AS n FROM anomalies n JOIN assets a ON a.id=n.asset_id JOIN systems s ON s.id=a.system_id JOIN asset_risk r ON r.asset_id=a.id WHERE n.status <> 'Closed' AND ${f.where} GROUP BY n.priority`, f.params);
	const byPri = { P1: 0, P2: 0, P3: 0, P4: 0 };
	for (const r of an) byPri[r.priority] = r.n;

	const [rep] = await db.query(
		`SELECT t.id, t.repair_type, t.expires_on, a.tag, n.reference FROM temporary_repairs t JOIN anomalies n ON n.id=t.anomaly_id JOIN assets a ON a.id=n.asset_id
		 JOIN systems s ON s.id=a.system_id JOIN asset_risk r ON r.asset_id=a.id WHERE t.removed_on IS NULL AND ${f.where} ORDER BY t.expires_on LIMIT 8`, f.params);
	const today = engine.today();
	const [low] = await db.query(`${SEL} ${FROM} WHERE ${f.where} AND r.remaining_life IS NOT NULL ORDER BY r.remaining_life, a.tag LIMIT 8`, f.params);
	const [next] = await db.query(`${SEL} ${FROM} WHERE ${f.where} AND r.due_date IS NOT NULL ORDER BY r.due_date, a.tag LIMIT 8`, f.params);

	res.json({
		kpis: { assets: k.assets, criticalA: +k.a || 0, overdue: +k.overdue || 0, dueSoon: +k.due_soon || 0, openAnomalies: Object.values(byPri).reduce((s, v) => s + v, 0), p1p2: byPri.P1 + byPri.P2, highRisk: +k.high || 0, notCalculable: +k.nc || 0 },
		matrix: settings.engine.matrix, counts: Object.fromEntries(cells.map((c) => [`${c.pof}-${c.cof}`, c.n])), anomaliesByPriority: byPri,
		repairs: rep.map((r) => ({ id: r.id, type: r.repair_type, expiresOn: d10(r.expires_on), tag: r.tag, reference: r.reference, ...engine.repairStatus(d10(r.expires_on), today, settings.engine) })),
		lowestLife: low.map(mapRow), nextInspections: next.map(mapRow),
	});
}));

router.post("/recompute", requireAdmin, wrap(async (_req, res) => {
	await risk.recompute(db, null);
	res.json({ ok: true });
}));

module.exports = router;
