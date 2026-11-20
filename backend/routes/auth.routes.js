const router = require("express").Router();
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const db = require("../config/db");
const { signToken, requireAuth } = require("../middleware/auth");
const { wrap, unauthorized, badRequest } = require("../utils/errors");
const { parse, z, password } = require("../utils/validate");
const { recordAudit } = require("../services/audit");

const loginLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 10,
	standardHeaders: true,
	legacyHeaders: false,
	message: { message: "Trop de tentatives, réessayez dans quelques minutes" },
});

// Hash factice : le temps de réponse ne révèle pas si l'email existe.
const DUMMY_HASH = bcrypt.hashSync("dummy-password", 12);

const publicUser = (u) => ({ id: u.id, email: u.email, fullName: u.fullName, isAdmin: u.isAdmin, locale: u.locale, facilityRoles: u.facilityRoles });

router.post("/login", loginLimiter, wrap(async (req, res) => {
	const { email, password: pwd } = parse(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(128) }), req.body);
	const [[row]] = await db.query("SELECT id, password_hash, is_active, token_version FROM users WHERE email = ? LIMIT 1", [email]);
	const ok = await bcrypt.compare(pwd, row?.password_hash || DUMMY_HASH);
	if (!row || !ok || !row.is_active) throw unauthorized("Email ou mot de passe incorrect");
	await db.query("UPDATE users SET last_login_at = NOW() WHERE id = ?", [row.id]);
	const { loadUser } = require("../middleware/auth");
	const user = await loadUser(row.id);
	res.json({ token: signToken({ id: row.id, token_version: row.token_version }), user: publicUser(user) });
}));

router.get("/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

router.put("/me", requireAuth, wrap(async (req, res) => {
	const { locale, fullName } = parse(z.object({ locale: z.enum(["fr", "en"]).optional(), fullName: z.string().trim().min(1).max(150).optional() }), req.body);
	await db.query("UPDATE users SET locale = COALESCE(?, locale), full_name = COALESCE(?, full_name) WHERE id = ?", [locale ?? null, fullName ?? null, req.user.id]);
	res.json({ ok: true });
}));

router.post("/change-password", requireAuth, loginLimiter, wrap(async (req, res) => {
	const { currentPassword, newPassword } = parse(z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }), req.body);
	const [[row]] = await db.query("SELECT password_hash FROM users WHERE id = ?", [req.user.id]);
	if (!(await bcrypt.compare(currentPassword, row.password_hash))) throw badRequest("Mot de passe actuel incorrect");
	const hash = await bcrypt.hash(newPassword, 12);
	// token_version + 1 : invalide les autres sessions ; on renvoie un nouveau token pour celle-ci.
	await db.query("UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?", [hash, req.user.id]);
	await recordAudit(null, req, { action: "password_change", entity: "user", entityId: req.user.id, label: req.user.email });
	res.json({ token: signToken({ id: req.user.id, token_version: req.user.tokenVersion + 1 }) });
}));

module.exports = router;
