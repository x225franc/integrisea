const db = require("../config/db");
const { unauthorized, forbidden, wrap } = require("../utils/errors");
const { hasRole } = require("../services/permissions");
const session = require("../services/session");

/** Charge l'utilisateur et ses droits depuis la base à chaque requête (compte désactivé ou droits modifiés = effet immédiat). */
async function loadUser(id) {
	const [[u]] = await db.query(
		"SELECT id, email, full_name, is_admin, locale, is_active, token_version FROM users WHERE id = ? LIMIT 1",
		[id],
	);
	if (!u) return null;
	const [roles] = await db.query("SELECT facility_id, role FROM user_facility_roles WHERE user_id = ?", [id]);
	return {
		id: u.id,
		email: u.email,
		fullName: u.full_name,
		isAdmin: !!u.is_admin,
		locale: u.locale,
		isActive: !!u.is_active,
		tokenVersion: u.token_version,
		facilityRoles: Object.fromEntries(roles.map((r) => [r.facility_id, r.role])),
	};
}

/**
 * Authentification par cookie httpOnly (jeton d'accès de 15 minutes). Les requêtes qui modifient des données doivent en plus
 * porter l'en-tête X-CSRF-Token lié à la session (protection CSRF). Aucun jeton n'est lisible par le script de la page.
 */
const requireAuth = wrap(async (req, _res, next) => {
	const decoded = session.verifyAccess(req);
	if (!(await session.isSessionLive(decoded.sid))) throw unauthorized("Session expirée, veuillez vous reconnecter");
	const user = await loadUser(Number(decoded.sub));
	if (!user || !user.isActive || user.tokenVersion !== decoded.tv) throw unauthorized("Session expirée, veuillez vous reconnecter");
	if (!session.checkCsrf(req, decoded.sid)) throw forbidden("Jeton CSRF invalide ou absent");
	req.user = user;
	req.sessionId = decoded.sid;
	next();
});

const requireAdmin = [
	requireAuth,
	(req, _res, next) => (req.user.isAdmin ? next() : next(forbidden())),
];

/** Exige minRole sur l'installation retournée par getFacilityId(req) (async autorisé). */
const requireFacilityRole = (minRole, getFacilityId) => [
	requireAuth,
	wrap(async (req, _res, next) => {
		const fid = await getFacilityId(req);
		if (fid == null || !hasRole(req.user, fid, minRole)) throw forbidden();
		req.facilityId = fid;
		next();
	}),
];

/** Administrateur ou ingénieur d'au moins une installation (données transverses : bibliothèque AMDE, catalogue de pièces). */
const requireEngineerAnywhere = [
	requireAuth,
	(req, _res, next) => (req.user.isAdmin || Object.values(req.user.facilityRoles).includes("engineer") ? next() : next(forbidden())),
];

module.exports = { loadUser, requireAuth, requireAdmin, requireFacilityRole, requireEngineerAnywhere };
