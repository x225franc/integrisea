const router = require("express").Router();
const bcrypt = require("bcrypt");
const db = require("../config/db");
const { withTransaction } = db;
const { requireAdmin } = require("../middleware/auth");
const { wrap, notFound, conflict, badRequest } = require("../utils/errors");
const { parse, z, password } = require("../utils/validate");
const { recordAudit, diff } = require("../services/audit");

router.use(requireAdmin);

const rolesSchema = z.array(z.object({ facilityId: z.number().int().positive(), role: z.enum(["reader", "inspector", "engineer"]) })).max(200);

async function fetchUser(conn, id) {
	const [[u]] = await conn.query("SELECT id, email, full_name, is_admin, locale, is_active, last_login_at, created_at FROM users WHERE id = ?", [id]);
	if (!u) return null;
	const [roles] = await conn.query("SELECT facility_id AS facilityId, role FROM user_facility_roles WHERE user_id = ? ORDER BY facility_id", [id]);
	return { id: u.id, email: u.email, fullName: u.full_name, isAdmin: !!u.is_admin, locale: u.locale, isActive: !!u.is_active, lastLoginAt: u.last_login_at, createdAt: u.created_at, facilityRoles: roles };
}

const writeRoles = async (conn, userId, roles) => {
	await conn.query("DELETE FROM user_facility_roles WHERE user_id = ?", [userId]);
	for (const r of roles) await conn.query("INSERT INTO user_facility_roles (user_id, facility_id, role) VALUES (?,?,?)", [userId, r.facilityId, r.role]);
};

router.get("/", wrap(async (_req, res) => {
	const [rows] = await db.query("SELECT id FROM users ORDER BY email");
	res.json(await Promise.all(rows.map((r) => fetchUser(db, r.id))));
}));

router.post("/", wrap(async (req, res) => {
	const d = parse(z.object({
		email: z.string().trim().toLowerCase().email(), fullName: z.string().trim().min(1).max(150), password,
		isAdmin: z.boolean().default(false), locale: z.enum(["fr", "en"]).default("fr"), facilityRoles: rolesSchema.default([]),
	}), req.body);
	const hash = await bcrypt.hash(d.password, 12);
	const created = await withTransaction(async (conn) => {
		const [[dup]] = await conn.query("SELECT id FROM users WHERE email = ?", [d.email]);
		if (dup) throw conflict("Cet email est déjà utilisé");
		const [r] = await conn.query("INSERT INTO users (email,password_hash,full_name,is_admin,locale) VALUES (?,?,?,?,?)", [d.email, hash, d.fullName, d.isAdmin ? 1 : 0, d.locale]);
		await writeRoles(conn, r.insertId, d.facilityRoles);
		const u = await fetchUser(conn, r.insertId);
		await recordAudit(conn, req, { action: "create", entity: "user", entityId: u.id, label: u.email, after: u });
		return u;
	});
	res.status(201).json(created);
}));

router.put("/:id(\\d+)", wrap(async (req, res) => {
	const id = Number(req.params.id);
	const d = parse(z.object({
		fullName: z.string().trim().min(1).max(150).optional(), isAdmin: z.boolean().optional(), locale: z.enum(["fr", "en"]).optional(),
		isActive: z.boolean().optional(), password: password.optional(), facilityRoles: rolesSchema.optional(),
	}), req.body);
	if (id === req.user.id && (d.isAdmin === false || d.isActive === false)) throw badRequest("Vous ne pouvez pas retirer vos propres droits ni désactiver votre compte");
	const updated = await withTransaction(async (conn) => {
		const before = await fetchUser(conn, id);
		if (!before) throw notFound("Utilisateur introuvable");
		await conn.query(
			"UPDATE users SET full_name = COALESCE(?, full_name), is_admin = COALESCE(?, is_admin), locale = COALESCE(?, locale), is_active = COALESCE(?, is_active) WHERE id = ?",
			[d.fullName ?? null, d.isAdmin == null ? null : +d.isAdmin, d.locale ?? null, d.isActive == null ? null : +d.isActive, id],
		);
		if (d.password) await conn.query("UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?", [await bcrypt.hash(d.password, 12), id]);
		// Un compte désactivé ou dont les droits changent perd ses sessions en cours.
		if (d.isActive === false || d.isAdmin !== undefined || d.facilityRoles) await conn.query("UPDATE users SET token_version = token_version + 1 WHERE id = ? AND id <> ?", [id, req.user.id]);
		if (d.facilityRoles) await writeRoles(conn, id, d.facilityRoles);
		const after = await fetchUser(conn, id);
		const ch = diff(before, after);
		if (ch.changed || d.password) await recordAudit(conn, req, { action: "update", entity: "user", entityId: id, label: after.email, before: ch.before, after: d.password ? { ...ch.after, password: "(modifié)" } : ch.after });
		return after;
	});
	res.json(updated);
}));

module.exports = router;
