// Classes d'équipements et attributs configurables (CFIHOS). Lecture pour tous, modification réservée à l'administrateur.
const router = require("express").Router();
const db = require("../config/db");
const { withTransaction } = db;
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { wrap, notFound, conflict } = require("../utils/errors");
const { parse, z, optStr } = require("../utils/validate");
const { recordAudit, diff } = require("../services/audit");

const bool = z.boolean().optional();
const classSchema = z.object({
	code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/).transform((s) => s.toUpperCase()),
	nameEn: z.string().trim().min(1).max(100),
	nameFr: z.string().trim().min(1).max(100),
	tracking: z.enum(["thickness", "condition"]),
	cfihosCode: optStr(40),
	isActive: bool,
	sortOrder: z.number().int().optional(),
});

const mapClass = (r) => ({ code: r.code, nameEn: r.name_en, nameFr: r.name_fr, tracking: r.tracking, cfihosCode: r.cfihos_code, isActive: !!r.is_active, sortOrder: r.sort_order });

router.get("/classes", requireAuth, wrap(async (_req, res) => {
	const [rows] = await db.query("SELECT * FROM asset_classes ORDER BY sort_order, code");
	res.json(rows.map(mapClass));
}));

router.post("/classes", requireAdmin, wrap(async (req, res) => {
	const d = parse(classSchema, req.body);
	await withTransaction(async (conn) => {
		const [[dup]] = await conn.query("SELECT code FROM asset_classes WHERE code = ?", [d.code]);
		if (dup) throw conflict("Ce code de classe existe déjà");
		await conn.query("INSERT INTO asset_classes (code,name_en,name_fr,tracking,cfihos_code,is_active,sort_order) VALUES (?,?,?,?,?,?,?)",
			[d.code, d.nameEn, d.nameFr, d.tracking, d.cfihosCode ?? null, d.isActive === false ? 0 : 1, d.sortOrder ?? 100]);
		await recordAudit(conn, req, { action: "create", entity: "asset_class", entityId: d.code, label: d.code, after: d });
	});
	res.status(201).json(d);
}));

router.put("/classes/:code", requireAdmin, wrap(async (req, res) => {
	const d = parse(classSchema.omit({ code: true }).partial(), req.body);
	const out = await withTransaction(async (conn) => {
		const [[row]] = await conn.query("SELECT * FROM asset_classes WHERE code = ?", [req.params.code.toUpperCase()]);
		if (!row) throw notFound();
		const before = mapClass(row);
		const next = { ...before, ...d };
		await conn.query("UPDATE asset_classes SET name_en=?, name_fr=?, tracking=?, cfihos_code=?, is_active=?, sort_order=? WHERE code=?",
			[next.nameEn, next.nameFr, next.tracking, next.cfihosCode ?? null, next.isActive ? 1 : 0, next.sortOrder, before.code]);
		const ch = diff(before, next);
		if (ch.changed) await recordAudit(conn, req, { action: "update", entity: "asset_class", entityId: before.code, label: before.code, ...ch });
		return next;
	});
	res.json(out);
}));

// --- Attributs supplémentaires ---
const attrSchema = z.object({
	classCode: z.preprocess((v) => (v === "" ? null : v), z.string().trim().toUpperCase().max(20).nullable()).optional(),
	attrKey: z.string().trim().min(1).max(50).regex(/^[a-z][a-z0-9_]*$/, "minuscules, chiffres et _"),
	labelEn: z.string().trim().min(1).max(100),
	labelFr: z.string().trim().min(1).max(100),
	dataType: z.enum(["text", "number", "date", "boolean"]).default("text"),
	cfihosRef: optStr(60),
	isActive: bool,
});

router.get("/attributes", requireAuth, wrap(async (_req, res) => {
	const [rows] = await db.query("SELECT * FROM asset_attribute_defs ORDER BY class_code, attr_key");
	res.json(rows.map((r) => ({ id: r.id, classCode: r.class_code, attrKey: r.attr_key, labelEn: r.label_en, labelFr: r.label_fr, dataType: r.data_type, cfihosRef: r.cfihos_ref, isActive: !!r.is_active })));
}));

router.post("/attributes", requireAdmin, wrap(async (req, res) => {
	const d = parse(attrSchema, req.body);
	const id = await withTransaction(async (conn) => {
		const [[dup]] = await conn.query("SELECT id FROM asset_attribute_defs WHERE attr_key = ? AND class_code <=> ?", [d.attrKey, d.classCode ?? null]);
		if (dup) throw conflict("Cet attribut existe déjà pour cette classe");
		const [r] = await conn.query("INSERT INTO asset_attribute_defs (class_code,attr_key,label_en,label_fr,data_type,cfihos_ref,is_active) VALUES (?,?,?,?,?,?,?)",
			[d.classCode ?? null, d.attrKey, d.labelEn, d.labelFr, d.dataType, d.cfihosRef ?? null, d.isActive === false ? 0 : 1]);
		await recordAudit(conn, req, { action: "create", entity: "asset_attribute_def", entityId: r.insertId, label: d.attrKey, after: d });
		return r.insertId;
	});
	res.status(201).json({ id, ...d });
}));

router.delete("/attributes/:id(\\d+)", requireAdmin, wrap(async (req, res) => {
	await withTransaction(async (conn) => {
		const [[row]] = await conn.query("SELECT * FROM asset_attribute_defs WHERE id = ?", [req.params.id]);
		if (!row) throw notFound();
		await conn.query("DELETE FROM asset_attribute_defs WHERE id = ?", [row.id]);
		await recordAudit(conn, req, { action: "delete", entity: "asset_attribute_def", entityId: row.id, label: row.attr_key, before: row });
	});
	res.status(204).end();
}));

module.exports = router;
