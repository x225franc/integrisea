const router = require("express").Router();
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const db = require("../config/db");
const { loadUser, requireAuth } = require("../middleware/auth");
const { wrap, badRequest, forbidden } = require("../utils/errors");
const { parse, z, password } = require("../utils/validate");
const { recordAudit } = require("../services/audit");
const session = require("../services/session");
const { providers, requireSecondFactor } = require("../services/authProviders");

// Limitation par adresse IP (en complément du verrouillage par compte).
const loginLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: Number(process.env.LOGIN_RATE_LIMIT || 10),
	standardHeaders: true,
	legacyHeaders: false,
	message: { message: "Trop de tentatives, réessayez dans quelques minutes" },
});

const publicUser = (u) => ({ id: u.id, email: u.email, fullName: u.fullName, isAdmin: u.isAdmin, locale: u.locale, facilityRoles: u.facilityRoles });

// Connexion : fournisseur d'identité → second facteur éventuel → ouverture de session (cookies). Aucun jeton dans la réponse.
router.post("/login", loginLimiter, wrap(async (req, res) => {
	const creds = parse(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(128) }), req.body);
	const identity = await providers.password.authenticate(req, creds);
	const second = await requireSecondFactor(req, identity);
	if (!second.ok) throw forbidden("Second facteur requis");
	await session.issueSession(req, res, identity);
	const user = await loadUser(identity.id);
	await recordAudit(null, { ip: req.ip, user }, { action: "login", entity: "user", entityId: user.id, label: user.email });
	res.json({ user: publicUser(user) });
}));

// Rafraîchissement : échange le cookie de rafraîchissement (usage unique, rotation) contre une nouvelle paire de jetons.
// Le contrôle CSRF est fait avant la rotation ; un jeton déjà utilisé qu'on rejoue révoque toute la session.
router.post("/refresh", wrap(async (req, res) => {
	const { user } = await session.rotate(req, res, loadUser);
	res.json({ user: publicUser(user) });
}));

// Déconnexion : révoque la session (cookie de rafraîchissement) et efface les cookies.
router.post("/logout", wrap(async (req, res) => {
	const info = await session.endSession(req, res);
	if (info) {
		const user = await loadUser(info.user_id);
		if (user) await recordAudit(null, { ip: req.ip, user }, { action: "logout", entity: "user", entityId: user.id, label: user.email });
	}
	res.json({ ok: true });
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
	// token_version + 1 invalide les jetons d'accès ; toutes les sessions sont révoquées, puis une nouvelle est ouverte pour celle-ci.
	await db.query("UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?", [hash, req.user.id]);
	await session.revokeAllForUser(req.user.id);
	await recordAudit(null, req, { action: "password_change", entity: "user", entityId: req.user.id, label: req.user.email });
	await session.issueSession(req, res, { id: req.user.id, token_version: req.user.tokenVersion + 1 });
	res.json({ ok: true });
}));

module.exports = router;
