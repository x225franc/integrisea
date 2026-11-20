// Configuration administrateur : paramètres du moteur et gabarits d'inspection.
// Toute modification est journalisée (avant/après) puis les risques sont recalculés immédiatement.
const router = require("express").Router();
const multer = require("multer");
const db = require("../config/db");
const { withTransaction } = db;
const engine = require("../../packages/engine");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { wrap, badRequest, notFound, conflict } = require("../utils/errors");
const { parse, z } = require("../utils/validate");
const { recordAudit } = require("../services/audit");
const settings = require("../services/settings");
const risk = require("../services/risk");
const { readTable, sendTable } = require("../services/tabular");
const { COLUMNS, parseStressRows, tableToRows } = require("../services/stressTable");

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
		// Toute modification redevient « provisoire » : elle doit être validée à nouveau par un administrateur.
		await conn.query(
			"INSERT INTO config_settings (setting_key, value_json, updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_by = VALUES(updated_by), validated_at = NULL, validated_by = NULL",
			[key, JSON.stringify(req.body.value), req.user.id]);
		await recordAudit(conn, req, { action: "config_change", entity: "setting", entityId: key, label: key, before: prev, after: req.body.value });
	});
	settings.invalidate();
	await risk.recompute(db, null); // effet immédiat sur les risques et les échéances
	res.json({ ok: true, value: (await settings.settingsForUi())[key] });
}));

// --- Validation d'un paramètre provisoire par un administrateur (ou retrait de la validation) ---
// Clés : un paramètre du moteur / de criticité, ou « template:ID » pour un gabarit d'inspection.
router.post("/:key/validate", requireAdmin, wrap(async (req, res) => {
	const key = req.params.key;
	const validated = req.body?.validated !== false;
	const tpl = /^template:([A-Z][A-Z0-9_]{0,19})$/.exec(key);
	await withTransaction(async (conn) => {
		if (tpl) {
			const [[t]] = await conn.query("SELECT id FROM inspection_templates WHERE id = ?", [tpl[1]]);
			if (!t) throw notFound("Gabarit introuvable");
			await conn.query(`UPDATE inspection_templates SET validated_at = ${validated ? "NOW()" : "NULL"}, validated_by = ? WHERE id = ?`, [validated ? req.user.id : null, tpl[1]]);
		} else {
			if (!settings.ALL_KEYS.includes(key)) throw notFound("Clé inconnue");
			// Un paramètre resté à sa valeur par défaut n'a pas de ligne : on l'écrit pour y attacher la validation.
			const current = await settings.loadSettings(conn);
			const value = settings.ENGINE_KEYS.includes(key) ? current.engine[key] : current[key];
			await conn.query(
				`INSERT INTO config_settings (setting_key, value_json, updated_by, validated_at, validated_by) VALUES (?,?,?,${validated ? "NOW()" : "NULL"},?)
				 ON DUPLICATE KEY UPDATE validated_at = VALUES(validated_at), validated_by = VALUES(validated_by)`,
				[key, JSON.stringify(value), req.user.id, validated ? req.user.id : null]);
		}
		await recordAudit(conn, req, { action: validated ? "config_validate" : "config_unvalidate", entity: "setting", entityId: key, label: key });
	});
	settings.invalidate();
	res.json({ ok: true, validated });
}));

// --- Table des contraintes admissibles : import / export Excel ou CSV (colonnes material, temp_c, s_mpa, family) ---
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

router.get("/allowable-stress/export", requireAdmin, wrap(async (req, res) => {
	const s = await settings.loadSettings();
	let rows = tableToRows(s.engine.allowableStress, s.engine.materialFamilies);
	if (!rows.length) rows = [{ material: "EXEMPLE", temp_c: 20, s_mpa: 100, family: "carbon" }]; // modèle à remplir (table vide en exploitation)
	await sendTable(res, "contraintes-admissibles", COLUMNS, rows, req.query.format);
}));

router.post("/allowable-stress/import", requireAdmin, upload.single("file"), wrap(async (req, res) => {
	if (!req.file) throw badRequest("Fichier manquant");
	let raw;
	try { raw = await readTable(req.file.buffer, req.file.originalname); } catch (e) { throw badRequest(`Fichier illisible : ${e.message}`); }
	if (!raw.length) throw badRequest("Le fichier ne contient aucune ligne");
	if (raw.length > 5000) throw badRequest("Maximum 5000 lignes");
	const parsed = parseStressRows(raw);
	const dryRun = req.query.dryRun === "1";
	if (parsed.errors.length) return res.status(422).json({ imported: false, errors: parsed.errors });
	if (dryRun) return res.json({ imported: false, dryRun: true, materials: parsed.materials, points: parsed.points });
	// L'import REMPLACE la table (et les familles des matériaux concernés). Fichier cohérent exigé : contrôle par le moteur.
	const probe = engine.defaultConfig();
	probe.allowableStress = parsed.allowableStress;
	const bad = engine.validateConfig(probe);
	if (bad.length) throw badRequest("Table invalide", bad.map((m) => ({ field: "allowableStress", message: m })));
	await withTransaction(async (conn) => {
		const before = await settings.loadSettings(conn);
		const families = { ...before.engine.materialFamilies, ...parsed.materialFamilies };
		for (const [k, v] of [["allowableStress", parsed.allowableStress], ["materialFamilies", families]]) {
			await conn.query(
				"INSERT INTO config_settings (setting_key, value_json, updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_by = VALUES(updated_by), validated_at = NULL, validated_by = NULL",
				[k, JSON.stringify(v), req.user.id]);
		}
		await recordAudit(conn, req, { action: "config_import", entity: "setting", entityId: "allowableStress", label: `allowableStress (${req.file.originalname})`,
			before: before.engine.allowableStress, after: parsed.allowableStress });
	});
	settings.invalidate();
	await risk.recompute(db, null);
	res.json({ imported: true, materials: parsed.materials, points: parsed.points });
}));

// --- Gabarits d'inspection ---
const fieldSchema = z.object({
	k: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]{0,29}$/, "clé : lettres, chiffres, _"), l: z.string().trim().min(1).max(200),
	t: z.enum(["cml", "grade", "select", "num", "pf", "text", "textarea"]), o: z.array(z.string().max(80)).max(30).optional(),
	sev: z.enum(["critical", "normal"]).optional(), // gravité d'un point de contrôle 'pf' (règle severityFail)
});
const ruleSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("anyFail"), grade: z.number().int().min(1).max(4) }),
	z.object({ type: z.literal("severityFail"), critical: z.number().int().min(1).max(4), normal: z.number().int().min(1).max(4), countAtLeast: z.number().int().min(1).max(40), countGrade: z.number().int().min(1).max(4) }),
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
		await conn.query("UPDATE inspection_templates SET name=?, classes=?, fields=?, `rules`=?, is_active=?, validated_at=NULL, validated_by=NULL WHERE id=?", [...row(req.params.id, t).slice(1), req.params.id]);
		await recordAudit(conn, req, { action: "update", entity: "inspection_template", entityId: req.params.id, label: t.name,
			before: { name: b.name, classes: b.classes, fields: b.fields, rules: b.rules, isActive: !!b.is_active }, after: t });
	});
	await risk.recompute(db, null);
	res.json({ id: req.params.id, ...t });
}));

module.exports = router;
