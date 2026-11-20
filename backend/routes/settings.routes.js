// Configuration administrateur : paramètres du moteur et gabarits d'inspection.
// Toute modification est journalisée (avant/après) puis les risques sont recalculés immédiatement.
const router = require("express").Router();
const db = require("../config/db");
const { withTransaction } = db;
const engine = require("../../packages/engine");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { wrap, badRequest, notFound, conflict } = require("../utils/errors");
const { parse, z } = require("../utils/validate");
const { recordAudit } = require("../services/audit");
const settings = require("../services/settings");
const risk = require("../services/risk");

// Lecture ouverte à tout utilisateur connecté : l'interface a besoin de la matrice, des échelles et des libellés.
router.get("/", requireAuth, wrap(async (_req, res) => res.json(await settings.settingsForUi())));

router.put("/:key", requireAdmin, wrap(async (req, res) => {
	const key = req.params.key;
	if (!("value" in (req.body || {}))) throw badRequest("Champ « value » manquant");
	const errs = await settings.validateSetting(key, req.body.value);
	if (errs.length) throw badRequest("Configuration invalide", errs.map((m) => ({ field: key, message: m })));
	await withTransaction(async (conn) => {
		const before = (await settings.loadSettings(conn));
		const prev = settings.ENGINE_KEYS.includes(key) ? before.engine[key] : before[key];
		await conn.query(
			"INSERT INTO config_settings (setting_key, value_json, updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_by = VALUES(updated_by)",
			[key, JSON.stringify(req.body.value), req.user.id]);
		await recordAudit(conn, req, { action: "config_change", entity: "setting", entityId: key, label: key, before: prev, after: req.body.value });
	});
	settings.invalidate();
	await risk.recompute(db, null); // effet immédiat sur les risques et les échéances
	res.json({ ok: true, value: (await settings.settingsForUi())[key] });
}));

// --- Gabarits d'inspection ---
const fieldSchema = z.object({
	k: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]{0,29}$/, "clé : lettres, chiffres, _"), l: z.string().trim().min(1).max(200),
	t: z.enum(["cml", "grade", "select", "num", "pf", "text", "textarea"]), o: z.array(z.string().max(80)).max(30).optional(),
});
const ruleSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("anyFail"), grade: z.number().int().min(1).max(4) }),
	z.object({ type: z.literal("failCountMap"), map: z.array(z.number().int().min(1).max(4)).min(1).max(12) }),
	z.object({ type: z.literal("deviation"), ref: z.string(), actual: z.string(), steps: z.array(z.tuple([z.number().positive(), z.number().int().min(1).max(4)])).min(1) }),
	z.object({ type: z.literal("equals"), field: z.string(), value: z.string(), grade: z.number().int().min(1).max(4) }),
	z.object({ type: z.literal("gt"), field: z.string(), steps: z.array(z.tuple([z.number(), z.number().int().min(1).max(4)])).min(1) }),
]);
const templateSchema = z.object({
	name: z.string().trim().min(1).max(150), classes: z.array(z.string().trim().min(1).max(20)).min(1).max(50),
	fields: z.array(fieldSchema).min(1).max(40), rules: z.array(ruleSchema).max(30).default([]), isActive: z.boolean().default(true),
});

function checkTemplate(t) {
	const keys = t.fields.map((f) => f.k);
	if (new Set(keys).size !== keys.length) throw badRequest("Clés de champ en double");
	for (const f of t.fields) if (f.t === "select" && !(f.o && f.o.length)) throw badRequest(`Champ « ${f.k} » : options requises`);
	if (t.fields.filter((f) => f.t === "cml").length > 1) throw badRequest("Un seul champ de relevés (cml) par gabarit");
	for (const r of t.rules) for (const f of [r.field, r.ref, r.actual].filter(Boolean)) if (!keys.includes(f)) throw badRequest(`Règle : champ inconnu « ${f} »`);
	// Essai à blanc : le gabarit doit pouvoir être évalué.
	engine.computeGrade({ fields: t.fields, rules: t.rules }, {});
}

const row = (id, t) => [id, t.name, JSON.stringify(t.classes), JSON.stringify(t.fields), JSON.stringify(t.rules), t.isActive ? 1 : 0];

router.post("/templates", requireAdmin, wrap(async (req, res) => {
	const id = parse(z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,19}$/, "id : majuscules, chiffres, _"), req.body?.id);
	const t = parse(templateSchema, req.body);
	checkTemplate(t);
	await withTransaction(async (conn) => {
		const [[dup]] = await conn.query("SELECT id FROM inspection_templates WHERE id = ?", [id]);
		if (dup) throw conflict("Ce gabarit existe déjà");
		await conn.query("INSERT INTO inspection_templates (id,name,classes,fields,`rules`,is_active) VALUES (?,?,?,?,?,?)", row(id, t));
		await recordAudit(conn, req, { action: "create", entity: "inspection_template", entityId: id, label: t.name, after: t });
	});
	res.status(201).json({ id, ...t });
}));

router.put("/templates/:id", requireAdmin, wrap(async (req, res) => {
	const t = parse(templateSchema, req.body);
	checkTemplate(t);
	await withTransaction(async (conn) => {
		const [[b]] = await conn.query("SELECT * FROM inspection_templates WHERE id = ?", [req.params.id]);
		if (!b) throw notFound();
		await conn.query("UPDATE inspection_templates SET name=?, classes=?, fields=?, `rules`=?, is_active=? WHERE id=?", [...row(req.params.id, t).slice(1), req.params.id]);
		await recordAudit(conn, req, { action: "update", entity: "inspection_template", entityId: req.params.id, label: t.name,
			before: { name: b.name, classes: b.classes, fields: b.fields, rules: b.rules, isActive: !!b.is_active }, after: t });
	});
	await risk.recompute(db, null);
	res.json({ id: req.params.id, ...t });
}));

module.exports = router;
