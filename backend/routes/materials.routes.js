// Catalogue de pièces de rechange, nomenclature (BoM) liant pièces et tags, alerte de stock minimum.
const router = require("express").Router();
const db = require("../config/db");
const { withTransaction } = db;
const { requireAuth, requireEngineerAnywhere } = require("../middleware/auth");
const { wrap, notFound, conflict, forbidden, badRequest } = require("../utils/errors");
const { parse, z, optStr } = require("../utils/validate");
const { recordAudit, diff } = require("../services/audit");
const { hasRole, facilityIdsWithRole } = require("../services/permissions");
const { facilityOfAsset } = require("../services/scope");
const { sendTable } = require("../services/tabular");

const partSchema = z.object({
	code: z.string().trim().min(1).max(40), description: z.string().trim().min(1).max(255), category: optStr(80),
	criticality: z.enum(["High", "Medium", "Low"]).default("Medium"), stock: z.coerce.number().int().min(0).max(1e7), minStock: z.coerce.number().int().min(0).max(1e7),
});

const map = (r) => ({ id: r.id, code: r.code, description: r.description, category: r.category, criticality: r.criticality, stock: r.stock, minStock: r.min_stock, lowStock: r.stock < r.min_stock, assets: r.assets ?? undefined });

// Les tags liés ne sont montrés que pour les installations accessibles.
async function tagsFor(user, partId) {
	const ids = facilityIdsWithRole(user);
	if (ids && !ids.length) return [];
	const [rows] = await db.query(
		`SELECT a.id, a.tag, b.quantity FROM bom b JOIN assets a ON a.id=b.asset_id JOIN systems s ON s.id=a.system_id WHERE b.part_id = ? ${ids ? "AND s.facility_id IN (?)" : ""} ORDER BY a.tag`, ids ? [partId, ids] : [partId]);
	return rows.map((r) => ({ assetId: r.id, tag: r.tag, quantity: r.quantity }));
}

router.get("/parts", requireAuth, wrap(async (req, res) => {
	const q = parse(z.object({ q: z.string().max(100).optional(), low: z.enum(["1"]).optional(), category: z.string().max(80).optional(), format: z.enum(["csv", "xlsx"]).optional() }), req.query);
	const where = [], params = [];
	if (q.q) { where.push("(p.code LIKE ? OR p.description LIKE ?)"); const l = `%${q.q.replace(/[%_\\]/g, "\\$&")}%`; params.push(l, l); }
	if (q.low) where.push("p.stock < p.min_stock");
	if (q.category) { where.push("p.category = ?"); params.push(q.category); }
	const [rows] = await db.query(`SELECT p.*, (SELECT COUNT(*) FROM bom b WHERE b.part_id = p.id) AS assets FROM spare_parts p ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY p.code`, params);
	const items = rows.map(map);
	if (q.format) return sendTable(res, "pieces-de-rechange", ["code", "description", "category", "criticality", "stock", "minStock", "lowStock"], items, q.format);
	res.json(items);
}));

router.get("/parts/:id(\\d+)", requireAuth, wrap(async (req, res) => {
	const [[p]] = await db.query("SELECT * FROM spare_parts WHERE id = ?", [req.params.id]);
	if (!p) throw notFound();
	res.json({ ...map(p), tags: await tagsFor(req.user, p.id) });
}));

router.post("/parts", requireEngineerAnywhere, wrap(async (req, res) => {
	const d = parse(partSchema, req.body);
	const id = await withTransaction(async (conn) => {
		const [[dup]] = await conn.query("SELECT id FROM spare_parts WHERE code = ?", [d.code]);
		if (dup) throw conflict("Ce code existe déjà");
		const [r] = await conn.query("INSERT INTO spare_parts (code,description,category,criticality,stock,min_stock) VALUES (?,?,?,?,?,?)", [d.code, d.description, d.category ?? null, d.criticality, d.stock, d.minStock]);
		await recordAudit(conn, req, { action: "create", entity: "spare_part", entityId: r.insertId, label: d.code, after: d });
		return r.insertId;
	});
	res.status(201).json({ id, ...d });
}));

router.put("/parts/:id(\\d+)", requireEngineerAnywhere, wrap(async (req, res) => {
	const d = parse(partSchema, req.body);
	await withTransaction(async (conn) => {
		const [[b]] = await conn.query("SELECT * FROM spare_parts WHERE id = ?", [req.params.id]);
		if (!b) throw notFound();
		const [[dup]] = await conn.query("SELECT id FROM spare_parts WHERE code = ? AND id <> ?", [d.code, b.id]);
		if (dup) throw conflict("Ce code existe déjà");
		await conn.query("UPDATE spare_parts SET code=?, description=?, category=?, criticality=?, stock=?, min_stock=? WHERE id=?", [d.code, d.description, d.category ?? null, d.criticality, d.stock, d.minStock, b.id]);
		const before = { code: b.code, description: b.description, category: b.category, criticality: b.criticality, stock: b.stock, minStock: b.min_stock };
		const ch = diff(before, { ...d, category: d.category ?? null });
		if (ch.changed) await recordAudit(conn, req, { action: "update", entity: "spare_part", entityId: b.id, label: d.code, ...ch });
	});
	res.json({ id: Number(req.params.id), ...d });
}));

router.delete("/parts/:id(\\d+)", requireEngineerAnywhere, wrap(async (req, res) => {
	await withTransaction(async (conn) => {
		const [[b]] = await conn.query("SELECT * FROM spare_parts WHERE id = ?", [req.params.id]);
		if (!b) throw notFound();
		await conn.query("DELETE FROM spare_parts WHERE id = ?", [b.id]);
		await recordAudit(conn, req, { action: "delete", entity: "spare_part", entityId: b.id, label: b.code, before: { code: b.code, description: b.description } });
	});
	res.status(204).end();
}));

// --- Nomenclature d'un actif ---
router.get("/bom", requireAuth, wrap(async (req, res) => {
	const assetId = Number(req.query.asset);
	if (!assetId) throw badRequest("Paramètre asset requis");
	const fid = await facilityOfAsset(assetId);
	if (fid == null || !hasRole(req.user, fid, "reader")) throw notFound();
	const [rows] = await db.query("SELECT p.*, b.quantity FROM bom b JOIN spare_parts p ON p.id=b.part_id WHERE b.asset_id = ? ORDER BY p.code", [assetId]);
	res.json(rows.map((r) => ({ ...map(r), quantity: r.quantity })));
}));

router.post("/bom", requireAuth, wrap(async (req, res) => {
	const d = parse(z.object({ assetId: z.number().int().positive(), partId: z.number().int().positive(), quantity: z.number().int().min(1).max(10000).default(1) }), req.body);
	await withTransaction(async (conn) => {
		const fid = await facilityOfAsset(d.assetId, conn);
		if (fid == null) throw badRequest("Actif inconnu");
		if (!hasRole(req.user, fid, "engineer")) throw forbidden();
		const [[p]] = await conn.query("SELECT code FROM spare_parts WHERE id = ?", [d.partId]);
		const [[a]] = await conn.query("SELECT tag FROM assets WHERE id = ?", [d.assetId]);
		if (!p) throw badRequest("Pièce inconnue");
		await conn.query("INSERT INTO bom (asset_id, part_id, quantity) VALUES (?,?,?) ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)", [d.assetId, d.partId, d.quantity]);
		await recordAudit(conn, req, { action: "bom_set", entity: "bom", entityId: `${d.assetId}:${d.partId}`, label: `${a.tag} ← ${p.code}`, facilityId: fid, after: d });
	});
	res.status(201).json({ ok: true });
}));

router.delete("/bom/:assetId(\\d+)/:partId(\\d+)", requireAuth, wrap(async (req, res) => {
	await withTransaction(async (conn) => {
		const fid = await facilityOfAsset(Number(req.params.assetId), conn);
		if (fid == null || !hasRole(req.user, fid, "engineer")) throw forbidden();
		await conn.query("DELETE FROM bom WHERE asset_id = ? AND part_id = ?", [req.params.assetId, req.params.partId]);
		await recordAudit(conn, req, { action: "bom_remove", entity: "bom", entityId: `${req.params.assetId}:${req.params.partId}`, facilityId: fid });
	});
	res.status(204).end();
}));

module.exports = router;
