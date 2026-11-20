const router = require("express").Router();
const multer = require("multer");
const db = require("../config/db");
const { withTransaction } = db;
const { requireAuth, requireFacilityRole } = require("../middleware/auth");
const { wrap, notFound, conflict, badRequest, forbidden } = require("../utils/errors");
const { parse, z, optStr } = require("../utils/validate");
const { recordAudit, diff } = require("../services/audit");
const { facilityIdsWithRole, hasRole } = require("../services/permissions");
const { COLUMNS, assetFields, mechanisms, parseImportRows, toExportRow } = require("../services/assetImport");
const { readTable, writeTable } = require("../services/tabular");
const risk = require("../services/risk");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

const SELECT = `SELECT a.*, s.code AS system_code, s.name AS system_name, s.facility_id, f.code AS facility_code, f.name AS facility_name
	FROM assets a JOIN systems s ON s.id = a.system_id JOIN facilities f ON f.id = s.facility_id`;

const parseJson = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const mapAsset = (r) => ({
	id: r.id, tag: r.tag, description: r.description, systemId: r.system_id, systemCode: r.system_code, systemName: r.system_name,
	facilityId: r.facility_id, facilityCode: r.facility_code, facilityName: r.facility_name, classCode: r.class_code,
	fluid: r.fluid, material: r.material, designPressureBarg: r.design_pressure_barg, designTempC: r.design_temp_c,
	odMm: r.od_mm, nominalThicknessMm: r.nominal_thickness_mm, installYear: r.install_year,
	degradationMechanisms: parseJson(r.degradation_mechanisms) || [], customAttributes: parseJson(r.custom_attributes) || {},
	crit: { s: r.crit_s, e: r.crit_e, p: r.crit_p }, archivedAt: r.archived_at, createdAt: r.created_at, updatedAt: r.updated_at,
});

/** Snapshot stable d'un actif pour l'audit (colonnes métier uniquement). */
const snapshot = (a) => ({
	tag: a.tag, description: a.description, systemCode: a.systemCode, classCode: a.classCode, fluid: a.fluid, material: a.material,
	designPressureBarg: a.designPressureBarg, designTempC: a.designTempC, odMm: a.odMm, nominalThicknessMm: a.nominalThicknessMm,
	installYear: a.installYear, degradationMechanisms: a.degradationMechanisms, customAttributes: a.customAttributes,
	critS: a.crit.s, critE: a.crit.e, critP: a.crit.p, archived: !!a.archivedAt,
});

const F = assetFields;
const bodySchema = z.object({
	tag: z.string().trim().min(1).max(60),
	systemId: z.number().int().positive(),
	classCode: z.string().trim().toUpperCase().min(1).max(20),
	degradationMechanisms: mechanisms.optional(),
	customAttributes: z.record(z.string(), z.union([z.string().max(255), z.number(), z.boolean(), z.null()])).optional(),
	description: F.description, fluid: F.fluid, material: F.material,
	designPressureBarg: F.design_pressure_barg, designTempC: F.design_temp_c, odMm: F.od_mm,
	nominalThicknessMm: F.nominal_thickness_mm, installYear: F.install_year,
	critS: F.crit_s, critE: F.crit_e, critP: F.crit_p,
});

async function getAsset(conn, id) {
	const [[r]] = await conn.query(`${SELECT} WHERE a.id = ?`, [id]);
	return r ? mapAsset(r) : null;
}

async function assertClassAndSystem(conn, classCode, systemId) {
	const [[c]] = await conn.query("SELECT code FROM asset_classes WHERE code = ? AND is_active = 1", [classCode]);
	if (!c) throw badRequest(`Classe inconnue ou inactive : ${classCode}`);
	const [[s]] = await conn.query("SELECT id, facility_id FROM systems WHERE id = ?", [systemId]);
	if (!s) throw badRequest("Système inconnu");
	return s.facility_id;
}

const toRow = (d) => [d.description, d.fluid ?? null, d.material ?? null, d.designPressureBarg ?? d.design_pressure_barg ?? null, d.designTempC ?? d.design_temp_c ?? null,
	d.odMm ?? d.od_mm ?? null, d.nominalThicknessMm ?? d.nominal_thickness_mm ?? null, d.installYear ?? d.install_year ?? null];

// --- Liste ---
router.get("/", requireAuth, wrap(async (req, res) => {
	const q = parse(z.object({
		q: z.string().trim().max(100).optional(), facility: z.coerce.number().int().optional(), system: z.coerce.number().int().optional(),
		class: z.string().trim().max(20).optional(), archived: z.enum(["0", "1", "all"]).default("0"),
		page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(500).default(100),
	}), req.query);
	const ids = facilityIdsWithRole(req.user);
	if (ids && !ids.length) return res.json({ total: 0, items: [] });
	const where = [], params = [];
	if (ids) { where.push("s.facility_id IN (?)"); params.push(ids); }
	if (q.facility) { where.push("s.facility_id = ?"); params.push(q.facility); }
	if (q.system) { where.push("a.system_id = ?"); params.push(q.system); }
	if (q.class) { where.push("a.class_code = ?"); params.push(q.class.toUpperCase()); }
	if (q.archived !== "all") where.push(q.archived === "1" ? "a.archived_at IS NOT NULL" : "a.archived_at IS NULL");
	if (q.q) { where.push("(a.tag LIKE ? OR a.description LIKE ?)"); const like = `%${q.q.replace(/[%_\\]/g, "\\$&")}%`; params.push(like, like); }
	const w = where.length ? "WHERE " + where.join(" AND ") : "";
	const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM assets a JOIN systems s ON s.id = a.system_id ${w}`, params);
	const [rows] = await db.query(`${SELECT} ${w} ORDER BY a.tag LIMIT ? OFFSET ?`, [...params, q.limit, (q.page - 1) * q.limit]);
	res.json({ total, items: rows.map(mapAsset) });
}));

// --- Export CSV / Excel (déclaré avant /:id) ---
router.get("/export", requireAuth, wrap(async (req, res) => {
	const format = req.query.format === "xlsx" ? "xlsx" : "csv";
	const ids = facilityIdsWithRole(req.user);
	const where = ["a.archived_at IS NULL"], params = [];
	if (ids) { if (!ids.length) throw forbidden(); where.push("s.facility_id IN (?)"); params.push(ids); }
	if (req.query.facility) { where.push("s.facility_id = ?"); params.push(Number(req.query.facility)); }
	const [rows] = await db.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY a.tag`, params);
	const buf = await writeTable(COLUMNS, rows.map(toExportRow), format, "Assets");
	res.set("Content-Type", format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8");
	res.set("Content-Disposition", `attachment; filename="assets.${format}"`);
	res.send(buf);
}));

// Modèle vide à remplir pour l'import.
router.get("/import-template", requireAuth, wrap(async (req, res) => {
	const format = req.query.format === "csv" ? "csv" : "xlsx";
	const example = { tag: "10-PL-9999", system: "AUR-M10", class: "PIPE", description: "Exemple", fluid: "Crude oil", material: "CS", design_pressure_barg: 20, design_temp_c: 80, od_mm: 168.3, nominal_thickness_mm: 7.11, install_year: 2014, degradation_mechanisms: "CO2 corrosion|CUI", crit_s: "", crit_e: "", crit_p: "" };
	const buf = await writeTable(COLUMNS, [example], format, "Assets");
	res.set("Content-Type", format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8");
	res.set("Content-Disposition", `attachment; filename="assets-template.${format}"`);
	res.send(buf);
}));

// --- Import : crée les tags nouveaux, met à jour les existants. Tout ou rien, sauf partial=1. ---
router.post("/import", requireAuth, upload.single("file"), wrap(async (req, res) => {
	if (!req.file) throw badRequest("Fichier manquant");
	const dryRun = req.query.dryRun === "1";
	const partial = req.query.partial === "1";
	let raw;
	try { raw = await readTable(req.file.buffer, req.file.originalname); } catch (e) { throw badRequest(`Fichier illisible : ${e.message}`); }
	if (!raw.length) throw badRequest("Le fichier ne contient aucune ligne");
	if (raw.length > 5000) throw badRequest("Maximum 5000 lignes par import");

	const [syss] = await db.query("SELECT id, code, facility_id FROM systems");
	const [cls] = await db.query("SELECT code FROM asset_classes WHERE is_active = 1");
	const { rows, errors } = parseImportRows(raw, {
		systemsByCode: new Map(syss.map((s) => [s.code, s])),
		classCodes: new Set(cls.map((c) => c.code)),
	});
	const allowed = rows.filter((r) => {
		if (hasRole(req.user, r.facilityId, "engineer")) return true;
		errors.push({ line: r.line, tag: r.tag, message: "Droits insuffisants sur l'installation de ce système" });
		return false;
	});
	if (errors.length && !partial) return res.status(422).json({ imported: false, created: 0, updated: 0, errors });
	if (dryRun) return res.json({ imported: false, dryRun: true, valid: allowed.length, errors });

	let created = 0, updated = 0;
	await withTransaction(async (conn) => {
		const touched = [];
		for (const r of allowed) {
			const d = r.data;
			const [[existing]] = await conn.query("SELECT id FROM assets WHERE tag = ?", [d.tag]);
			if (existing) {
				const before = await getAsset(conn, existing.id);
				await conn.query(
					`UPDATE assets SET system_id=?, class_code=?, description=?, fluid=?, material=?, design_pressure_barg=?, design_temp_c=?, od_mm=?, nominal_thickness_mm=?, install_year=?,
					 degradation_mechanisms=?, crit_s=?, crit_e=?, crit_p=? WHERE id=?`,
					[d.system_id, d.class_code, ...toRow(d), JSON.stringify(d.degradation_mechanisms), d.crit_s ?? null, d.crit_e ?? null, d.crit_p ?? null, existing.id],
				);
				const after = await getAsset(conn, existing.id);
				const ch = diff(snapshot(before), snapshot(after));
				if (ch.changed) await recordAudit(conn, req, { action: "import_update", entity: "asset", entityId: existing.id, label: d.tag, facilityId: after.facilityId, ...ch });
				updated++; touched.push(existing.id);
			} else {
				const [ins] = await conn.query(
					`INSERT INTO assets (tag,system_id,class_code,description,fluid,material,design_pressure_barg,design_temp_c,od_mm,nominal_thickness_mm,install_year,degradation_mechanisms,crit_s,crit_e,crit_p,created_by)
					 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
					[d.tag, d.system_id, d.class_code, ...toRow(d), JSON.stringify(d.degradation_mechanisms), d.crit_s ?? null, d.crit_e ?? null, d.crit_p ?? null, req.user.id],
				);
				const after = await getAsset(conn, ins.insertId);
				await recordAudit(conn, req, { action: "import_create", entity: "asset", entityId: ins.insertId, label: d.tag, facilityId: after.facilityId, after: snapshot(after) });
				created++; touched.push(ins.insertId);
			}
		}
		if (touched.length) await risk.recompute(conn, touched);
	});
	res.json({ imported: true, created, updated, errors });
}));

// --- Fiche ---
router.get("/:id(\\d+)", requireAuth, wrap(async (req, res) => {
	const a = await getAsset(db, req.params.id);
	if (!a || !hasRole(req.user, a.facilityId, "reader")) throw notFound("Actif introuvable");
	res.json(a);
}));

// --- Création ---
router.post("/", requireAuth, wrap(async (req, res) => {
	const d = parse(bodySchema, req.body);
	const out = await withTransaction(async (conn) => {
		const facilityId = await assertClassAndSystem(conn, d.classCode, d.systemId);
		if (!hasRole(req.user, facilityId, "engineer")) throw forbidden();
		const [[dup]] = await conn.query("SELECT id FROM assets WHERE tag = ?", [d.tag]);
		if (dup) throw conflict("Ce tag existe déjà");
		const [r] = await conn.query(
			`INSERT INTO assets (tag,system_id,class_code,description,fluid,material,design_pressure_barg,design_temp_c,od_mm,nominal_thickness_mm,install_year,degradation_mechanisms,custom_attributes,crit_s,crit_e,crit_p,created_by)
			 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			[d.tag, d.systemId, d.classCode, ...toRow(d), JSON.stringify(d.degradationMechanisms ?? []), JSON.stringify(d.customAttributes ?? {}), d.critS ?? null, d.critE ?? null, d.critP ?? null, req.user.id],
		);
		await risk.recompute(conn, [r.insertId]);
		const a = await getAsset(conn, r.insertId);
		await recordAudit(conn, req, { action: "create", entity: "asset", entityId: a.id, label: a.tag, facilityId, after: snapshot(a) });
		return a;
	});
	res.status(201).json(out);
}));

// --- Modification (le changement de criticité est journalisé comme toute autre donnée d'intégrité) ---
router.put("/:id(\\d+)", requireAuth, wrap(async (req, res) => {
	const id = Number(req.params.id);
	const d = parse(bodySchema.partial(), req.body);
	const out = await withTransaction(async (conn) => {
		const before = await getAsset(conn, id);
		if (!before || !hasRole(req.user, before.facilityId, "engineer")) throw before ? forbidden() : notFound("Actif introuvable");
		const m = { ...before, ...d };
		const systemId = d.systemId ?? before.systemId, classCode = d.classCode ?? before.classCode;
		const newFacility = await assertClassAndSystem(conn, classCode, systemId);
		if (newFacility !== before.facilityId && !hasRole(req.user, newFacility, "engineer")) throw forbidden();
		if (d.tag && d.tag !== before.tag) {
			const [[dup]] = await conn.query("SELECT id FROM assets WHERE tag = ? AND id <> ?", [d.tag, id]);
			if (dup) throw conflict("Ce tag existe déjà");
		}
		const has = (k) => Object.prototype.hasOwnProperty.call(d, k);
		const v = (k, cur) => (has(k) ? d[k] ?? null : cur);
		await conn.query(
			`UPDATE assets SET tag=?, system_id=?, class_code=?, description=?, fluid=?, material=?, design_pressure_barg=?, design_temp_c=?, od_mm=?, nominal_thickness_mm=?, install_year=?,
			 degradation_mechanisms=?, custom_attributes=?, crit_s=?, crit_e=?, crit_p=? WHERE id=?`,
			[m.tag, systemId, classCode, m.description, v("fluid", before.fluid), v("material", before.material),
				v("designPressureBarg", before.designPressureBarg), v("designTempC", before.designTempC), v("odMm", before.odMm),
				v("nominalThicknessMm", before.nominalThicknessMm), v("installYear", before.installYear),
				JSON.stringify(d.degradationMechanisms ?? before.degradationMechanisms), JSON.stringify(d.customAttributes ?? before.customAttributes),
				v("critS", before.crit.s), v("critE", before.crit.e), v("critP", before.crit.p), id],
		);
		await risk.recompute(conn, [id]);
		const after = await getAsset(conn, id);
		const ch = diff(snapshot(before), snapshot(after));
		if (ch.changed) await recordAudit(conn, req, { action: "update", entity: "asset", entityId: id, label: after.tag, facilityId: after.facilityId, ...ch });
		return after;
	});
	res.json(out);
}));

// --- Archivage / restauration (pas de suppression : l'historique d'intégrité est conservé) ---
const setArchived = (archive) => wrap(async (req, res) => {
	const id = Number(req.params.id);
	const out = await withTransaction(async (conn) => {
		const before = await getAsset(conn, id);
		if (!before || !hasRole(req.user, before.facilityId, "engineer")) throw before ? forbidden() : notFound("Actif introuvable");
		await conn.query(`UPDATE assets SET archived_at = ${archive ? "NOW()" : "NULL"} WHERE id = ?`, [id]);
		const after = await getAsset(conn, id);
		await recordAudit(conn, req, { action: archive ? "archive" : "restore", entity: "asset", entityId: id, label: after.tag, facilityId: after.facilityId });
		return after;
	});
	res.json(out);
});
router.post("/:id(\\d+)/archive", requireAuth, setArchived(true));
router.post("/:id(\\d+)/restore", requireAuth, setArchived(false));

module.exports = router;
