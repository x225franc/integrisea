// Sessions : jeton d'accès de courte durée + jeton de rafraîchissement à rotation, tous deux en cookies httpOnly ;
// protection CSRF par jeton lié à la session (envoyé dans l'en-tête X-CSRF-Token, jamais stocké côté navigateur hors cookie lisible).
//
//  integrisea_at   jeton d'accès (JWT, 15 min)           httpOnly · SameSite=Strict · Secure (HTTPS) · path /api
//  integrisea_rt   jeton de rafraîchissement (opaque)    httpOnly · SameSite=Strict · Secure (HTTPS) · path /api/auth · rotation à chaque usage
//  integrisea_csrf jeton CSRF (HMAC de l'identifiant de session) lisible par le script · SameSite=Strict · Secure (HTTPS)
//
// Cette couche est volontairement indépendante de la manière dont l'identité a été prouvée : un fournisseur d'identité
// (mot de passe aujourd'hui ; OIDC / Azure AD demain) appelle issueSession() une fois l'utilisateur authentifié, et un second
// facteur s'insère entre les deux (voir services/authProviders). Aucun autre code n'a besoin de changer.
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const { withTransaction } = db;
const { unauthorized, forbidden } = require("../utils/errors");
const { recordAudit } = require("./audit");

const COOKIE = { access: "integrisea_at", refresh: "integrisea_rt", csrf: "integrisea_csrf" };
const ACCESS_MINUTES = () => Number(process.env.ACCESS_TOKEN_MINUTES || 15);
const REFRESH_HOURS = () => Number(process.env.REFRESH_TOKEN_HOURS || 8);
// Durée de session maximale ABSOLUE : le jeton de rafraîchissement se renouvelle (durée glissante) mais jamais au-delà ; une nouvelle connexion est alors obligatoire.
const SESSION_MAX_HOURS = () => Number(process.env.SESSION_MAX_HOURS || 12);
const REUSE_GRACE_SECONDS = 10; // deux onglets qui rafraîchissent en même temps ne sont pas une attaque

/**
 * Attribut Secure des cookies. COOKIE_SECURE=true / false le force ; vide ou « auto » (défaut) : Secure si la connexion
 * arrive réellement en HTTPS (directement, ou via un proxy TLS qui transmet X-Forwarded-Proto : voir TRUST_PROXY).
 * Un cookie Secure est refusé par le navigateur en HTTP simple (hors localhost) : forcer « true » sur une installation
 * accessible en HTTP ferait échouer silencieusement la connexion, d'où ce choix automatique.
 */
const useSecure = (req) => {
	const v = String(process.env.COOKIE_SECURE || "auto").toLowerCase();
	return v === "true" ? true : v === "false" ? false : !!req?.secure;
};

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const csrfFor = (sid) => crypto.createHmac("sha256", process.env.JWT_SECRET).update(`csrf:${sid}`).digest("hex");
const safeEqual = (a, b) => {
	const x = Buffer.from(String(a)), y = Buffer.from(String(b));
	return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function parseCookies(req) {
	const out = {};
	for (const part of String(req.headers.cookie || "").split(";")) {
		const i = part.indexOf("=");
		if (i < 1) continue;
		try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* cookie illisible : ignoré */ }
	}
	return out;
}

function signAccess(user, sid) {
	return jwt.sign({ sub: user.id, tv: user.token_version ?? user.tokenVersion, sid }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: `${ACCESS_MINUTES()}m` });
}

function setCookies(req, res, { access, refresh, sid }) {
	const secure = useSecure(req);
	const base = { httpOnly: true, secure, sameSite: "strict" };
	const refreshMs = REFRESH_HOURS() * 3600e3;
	res.cookie(COOKIE.access, access, { ...base, path: "/api", maxAge: ACCESS_MINUTES() * 60e3 });
	res.cookie(COOKIE.refresh, refresh, { ...base, path: "/api/auth", maxAge: refreshMs });
	res.cookie(COOKIE.csrf, csrfFor(sid), { httpOnly: false, secure, sameSite: "strict", path: "/", maxAge: refreshMs });
}

function clearCookies(req, res) {
	const secure = useSecure(req);
	const base = { httpOnly: true, secure, sameSite: "strict" };
	res.clearCookie(COOKIE.access, { ...base, path: "/api" });
	res.clearCookie(COOKIE.refresh, { ...base, path: "/api/auth" });
	res.clearCookie(COOKIE.csrf, { secure, sameSite: "strict", path: "/" });
}

/**
 * Crée un jeton de rafraîchissement. `parentId` : jeton remplacé (rotation) dont on reprend la date de début de session ;
 * l'expiration est plafonnée à début de session + SESSION_MAX_HOURS, quelle que soit l'activité.
 */
async function insertRefresh(conn, req, user, familyId, parentId = null) {
	const raw = crypto.randomBytes(48).toString("base64url");
	const common = [user.id, familyId, sha256(raw), user.token_version ?? user.tokenVersion];
	const tail = [req.ip ?? null, String(req.headers["user-agent"] || "").slice(0, 255) || null];
	const cols = "user_id, family_id, token_hash, token_version, session_started_at, expires_at, ip, user_agent";
	const [r] = parentId
		? await conn.query(
			`INSERT INTO refresh_tokens (${cols})
			 SELECT ?,?,?,?, session_started_at, LEAST(DATE_ADD(NOW(), INTERVAL ? HOUR), DATE_ADD(session_started_at, INTERVAL ? HOUR)), ?, ? FROM refresh_tokens WHERE id = ?`,
			[...common, REFRESH_HOURS(), SESSION_MAX_HOURS(), ...tail, parentId])
		: await conn.query(
			`INSERT INTO refresh_tokens (${cols}) VALUES (?,?,?,?, NOW(), DATE_ADD(NOW(), INTERVAL ? HOUR), ?, ?)`,
			[...common, Math.min(REFRESH_HOURS(), SESSION_MAX_HOURS()), ...tail]);
	return { raw, id: r.insertId };
}

/** Ouvre une session pour un utilisateur DÉJÀ authentifié (par n'importe quel fournisseur). `user` : { id, token_version }. */
async function issueSession(req, res, user) {
	const sid = crypto.randomUUID();
	const { raw } = await insertRefresh(db, req, user, sid);
	setCookies(req, res, { access: signAccess(user, sid), refresh: raw, sid });
	if (Math.random() < 0.02) db.query("DELETE FROM refresh_tokens WHERE expires_at < DATE_SUB(NOW(), INTERVAL 1 DAY)").catch(() => {}); // ménage occasionnel
	return { sid };
}

const revokeFamily = (familyId, conn = db) => conn.query("UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE family_id = ?", [familyId]);
const revokeAllForUser = (userId, conn = db) => conn.query("UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = ?", [userId]);

/**
 * Rotation : échange le jeton de rafraîchissement du cookie contre un nouveau couple de jetons.
 * Un jeton déjà utilisé qu'on rejoue (hors délai de grâce) révèle un vol probable : toute la famille est révoquée.
 * Retourne { userId, sid }.
 */
async function rotate(req, res, loadUser) {
	const raw = parseCookies(req)[COOKIE.refresh];
	if (!raw) throw unauthorized("Session expirée, veuillez vous reconnecter");
	const hash = sha256(raw);
	let outcome;
	let reuse = null;
	let csrfBad = false;
	await withTransaction(async (conn) => {
		const [[row]] = await conn.query(
			`SELECT id, user_id, family_id, token_version, revoked_at, (expires_at > NOW() AND session_started_at > DATE_SUB(NOW(), INTERVAL ? HOUR)) AS live, TIMESTAMPDIFF(SECOND, revoked_at, NOW()) AS revoked_age
			 FROM refresh_tokens WHERE token_hash = ? FOR UPDATE`, [SESSION_MAX_HOURS(), hash]);
		if (!row) return;
		// CSRF vérifié AVANT de consommer le jeton : une requête forgée ne doit ni faire tourner ni invalider la session.
		if (!checkCsrf(req, row.family_id)) { csrfBad = true; return; }
		if (row.revoked_at) {
			if (row.revoked_age > REUSE_GRACE_SECONDS) { await revokeFamily(row.family_id, conn); reuse = row; }
			return;
		}
		if (!row.live) return;
		const user = await loadUser(row.user_id);
		if (!user || !user.isActive || user.tokenVersion !== row.token_version) { await revokeFamily(row.family_id, conn); return; }
		const next = await insertRefresh(conn, req, user, row.family_id, row.id);
		await conn.query("UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by = ? WHERE id = ?", [next.id, row.id]);
		outcome = { user, sid: row.family_id, refresh: next.raw };
	});
	if (reuse) {
		await recordAudit(null, { ip: req.ip, user: { id: reuse.user_id } }, { action: "refresh_reuse", entity: "session", entityId: reuse.family_id, label: "Jeton de rafraîchissement rejoué : sessions révoquées" }).catch(() => {});
	}
	if (csrfBad) throw forbidden("Jeton CSRF invalide ou absent");
	if (!outcome) { clearCookies(req, res); throw unauthorized("Session expirée, veuillez vous reconnecter"); }
	setCookies(req, res, { access: signAccess({ id: outcome.user.id, tokenVersion: outcome.user.tokenVersion }, outcome.sid), refresh: outcome.refresh, sid: outcome.sid });
	return { user: outcome.user, sid: outcome.sid };
}

/** Révoque la session désignée par le cookie de rafraîchissement (déconnexion) et efface les cookies. */
async function endSession(req, res) {
	const raw = parseCookies(req)[COOKIE.refresh];
	let info = null;
	if (raw) {
		const [[row]] = await db.query("SELECT user_id, family_id FROM refresh_tokens WHERE token_hash = ?", [sha256(raw)]);
		if (row) { await revokeFamily(row.family_id); info = row; }
	}
	clearCookies(req, res);
	return info;
}

/** Vérifie le jeton d'accès du cookie. Retourne les revendications { sub, tv, sid } ou lève 401. */
function verifyAccess(req) {
	const token = parseCookies(req)[COOKIE.access];
	if (!token) throw unauthorized();
	try { return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] }); } catch { throw unauthorized("Session expirée"); }
}

/** La session (famille de jetons) est-elle toujours active ? Déconnexion, rejeu détecté ou changement de mot de passe la révoquent aussitôt. */
async function isSessionLive(sid) {
	const [[r]] = await db.query("SELECT 1 AS ok FROM refresh_tokens WHERE family_id = ? AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1", [sid]);
	return !!r;
}

/** Protection CSRF : sur les méthodes qui modifient, l'en-tête X-CSRF-Token doit égaler le cookie ET le HMAC de la session. */
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
function checkCsrf(req, sid) {
	if (SAFE.has(req.method)) return true;
	const header = req.headers["x-csrf-token"];
	const cookie = parseCookies(req)[COOKIE.csrf];
	if (!header || !cookie || !sid) return false;
	return safeEqual(header, cookie) && safeEqual(header, csrfFor(sid));
}

module.exports = { COOKIE, issueSession, rotate, endSession, verifyAccess, isSessionLive, checkCsrf, signAccess, revokeAllForUser, revokeFamily, setCookies, parseCookies, csrfFor, useSecure };
