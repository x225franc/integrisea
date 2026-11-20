const router = require("express").Router();
const db = require("../config/db");
const { withTransaction } = db;
const { requireAuth, requireAdmin, requireFacilityRole } = require("../middleware/auth");
const { wrap, notFound, conflict } = require("../utils/errors");
const { parse, z, optStr } = require("../utils/validate");
const { recordAudit, diff } = require("../services/audit");
const { facilityIdsWithRole } = require("../services/permissions");

const code = (n) => z.string().trim().min(1).max(n).regex(/^[A-Za-z0-9_.-]+$/, "Lettres, chiffres, - _ . uniquement").transform((s) => s.toUpperCase());

// --- Installations ---
router.get("/facilities", requireAuth, wrap(async (req, res) => {
	const ids = facilityIdsWithRole(req.user);
	if (ids && !ids.length) return res.json([]);
	const [rows] = await db.query(
		`SELECT f.id, f.code, f.name, f.type, (SELECT COUNT(*) FROM systems s WHERE s.facility_id = f.id) AS systems
		 FROM facilities f ${ids ? "WHERE f.id IN (?)" : ""} ORDER BY f.name`, ids ? [ids] : []);
	res.json(rows.map((r) => ({ ...r, role: req.user.isAdmin ? "admin" : req.user.facilityRoles[r.id] })));
}));

const facilitySchema = z.object({ code: code(20), name: z.string().trim().min(1).max(150), type: optStr(100) });

router.post("/facilities", requireAdmin, wrap(async (req, res) => {
	const d = parse(facilitySchema, req.body);
	const out = await withTransaction(async (conn) => {
		const [[dup]] = await conn.query("SELECT id FROM facilities WHERE code = ?", [d.code]);
		if (dup) throw conflict("Ce code d'installation existe déjà");
		const [r] = await conn.query("INSERT INTO facilities (code,name,type) VALUES (?,?,?)", [d.code, d.name, d.type ?? null]);
		await recordAudit(conn, req, { action: "create", entity: "facility", entityId: r.insertId, label: d.name, facilityId: r.insertId, after: d });
		return { id: r.insertId, ...d };
	});
	res.status(201).json(out);
}));

router.put("/facilities/:id(\\d+)", requireAdmin, wrap(async (req, res) => {
	const id = Number(req.params.id);
	const d = parse(facilitySchema.partial(), req.body);
	const out = await withTransaction(async (conn) => {
		const [[before]] = await conn.query("SELECT id, code, name, type FROM facilities WHERE id = ?", [id]);
		if (!before) throw notFound();
		const next = { ...before, ...d };
		if (d.code && d.code !== before.code) {
			const [[dup]] = await conn.query("SELECT id FROM facilities WHERE code = ? AND id <> ?", [d.code, id]);
			if (dup) throw conflict("Ce code d'installation existe déjà");
		}
		await conn.query("UPDATE facilities SET code=?, name=?, type=? WHERE id=?", [next.code, next.name, next.type ?? null, id]);
		const ch = diff(before, next);
		if (ch.changed) await recordAudit(conn, req, { action: "update", entity: "facility", entityId: id, label: next.name, facilityId: id, ...ch });
		return next;
	});
	res.json(out);
}));

// --- Systèmes fonctionnels (modifiables par l'ingénieur de l'installation) ---
router.get("/systems", requireAuth, wrap(async (req, res) => {
	const ids = facilityIdsWithRole(req.user);
	if (ids && !ids.length) return res.json([]);
	const where = [], params = [];
	if (ids) { where.push("s.facility_id IN (?)"); params.push(ids); }
	if (req.query.facility) { where.push("s.facility_id = ?"); params.push(Number(req.query.facility)); }
	const [rows] = await db.query(
		`SELECT s.id, s.code, s.name, s.facility_id AS facilityId, (SELECT COUNT(*) FROM assets a WHERE a.system_id = s.id AND a.archived_at IS NULL) AS assets
		 FROM systems s ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY s.code`, params);
	res.json(rows);
}));

const systemSchema = z.object({ code: code(30), name: z.string().trim().min(1).max(150) });
const facilityOfBody = (req) => Number(req.body?.facilityId);

router.post("/systems", requireFacilityRole("engineer", facilityOfBody), wrap(async (req, res) => {
	const d = parse(systemSchema, req.body);
	const out = await withTransaction(async (conn) => {
		const [[fac]] = await conn.query("SELECT id FROM facilities WHERE id = ?", [req.facilityId]);
		if (!fac) throw notFound("Installation introuvable");
		const [[dup]] = await conn.query("SELECT id FROM systems WHERE code = ?", [d.code]);
		if (dup) throw conflict("Ce code de système existe déjà");
		const [r] = await conn.query("INSERT INTO systems (facility_id,code,name) VALUES (?,?,?)", [req.facilityId, d.code, d.name]);
		await recordAudit(conn, req, { action: "create", entity: "system", entityId: r.insertId, label: d.code, facilityId: req.facilityId, after: d });
		return { id: r.insertId, facilityId: req.facilityId, ...d };
	});
	res.status(201).json(out);
}));

const facilityOfSystem = async (req) => (await db.query("SELECT facility_id FROM systems WHERE id = ?", [req.params.id]))[0][0]?.facility_id;

router.put("/systems/:id(\\d+)", requireFacilityRole("engineer", facilityOfSystem), wrap(async (req, res) => {
	const id = Number(req.params.id);
	const d = parse(systemSchema.partial(), req.body);
	const out = await withTransaction(async (conn) => {
		const [[before]] = await conn.query("SELECT id, code, name FROM systems WHERE id = ?", [id]);
		const next = { ...before, ...d };
		if (d.code && d.code !== before.code) {
			const [[dup]] = await conn.query("SELECT id FROM systems WHERE code = ? AND id <> ?", [d.code, id]);
			if (dup) throw conflict("Ce code de système existe déjà");
		}
		await conn.query("UPDATE systems SET code=?, name=? WHERE id=?", [next.code, next.name, id]);
		const ch = diff(before, next);
		if (ch.changed) await recordAudit(conn, req, { action: "update", entity: "system", entityId: id, label: next.code, facilityId: req.facilityId, ...ch });
		return next;
	});
	res.json(out);
}));

router.delete("/systems/:id(\\d+)", requireFacilityRole("engineer", facilityOfSystem), wrap(async (req, res) => {
	const id = Number(req.params.id);
	await withTransaction(async (conn) => {
		const [[s]] = await conn.query("SELECT id, code, name FROM systems WHERE id = ?", [id]);
		const [[n]] = await conn.query("SELECT COUNT(*) AS n FROM assets WHERE system_id = ?", [id]);
		if (n.n > 0) throw conflict("Ce système contient des actifs : déplacez-les ou archivez-les d'abord");
		await conn.query("DELETE FROM systems WHERE id = ?", [id]);
		await recordAudit(conn, req, { action: "delete", entity: "system", entityId: id, label: s.code, facilityId: req.facilityId, before: s });
	});
	res.status(204).end();
}));

module.exports = router;
