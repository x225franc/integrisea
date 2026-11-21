// Fournisseur d'identité « email + mot de passe », avec verrouillage de compte :
// MAX_FAILURES échecs consécutifs bloquent CE compte pendant LOCK_MINUTES (en plus de la limitation par adresse IP de la route).
// Chaque échec, verrouillage et tentative sur un compte verrouillé est inscrit dans la piste d'audit.
const bcrypt = require("bcrypt");
const db = require("../../config/db");
const { unauthorized } = require("../../utils/errors");
const { recordAudit } = require("../audit");

const MAX_FAILURES = Number(process.env.LOGIN_MAX_FAILURES || 5);
const LOCK_MINUTES = Number(process.env.LOGIN_LOCK_MINUTES || 15);
// Message unique pour tout refus (mauvais identifiants, compte inconnu, compte verrouillé) : rien ne révèle quels comptes existent.
const GENERIC_MESSAGE = "Identifiants invalides ou compte temporairement verrouillé";
// Hash factice : le temps de réponse ne révèle pas si l'email existe.
const DUMMY_HASH = bcrypt.hashSync("dummy-password", 12);

const auditAs = (req, row, email) => ({ ip: req.ip, user: row ? { id: row.id, email } : { id: null, email: String(email).slice(0, 190) } });

/**
 * Prouve l'identité : retourne { id, token_version } ou lève 401 avec le même message dans tous les cas de refus (y compris compte verrouillé).
 * Contrat commun à tout fournisseur : « retourner l'utilisateur authentifié ». Un fournisseur OIDC / Azure AD aurait la même forme.
 */
async function authenticate(req, { email, password }) {
	const [[row]] = await db.query(
		"SELECT id, password_hash, is_active, token_version, failed_logins, locked_until, (locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked, CEIL(TIMESTAMPDIFF(SECOND, NOW(), locked_until) / 60) AS minutes_left FROM users WHERE email = ? LIMIT 1",
		[email]);

	// Le mot de passe est toujours vérifié (même sur un compte verrouillé) : le temps de réponse ne distingue pas les cas.
	const ok = await bcrypt.compare(password, row?.password_hash || DUMMY_HASH);
	if (row?.is_locked) {
		// Le verrouillage reste visible de l'administrateur et dans la piste d'audit, jamais de l'appelant.
		await recordAudit(null, auditAs(req, row, email), { action: "login_blocked", entity: "user", entityId: row.id, label: email });
		throw unauthorized(GENERIC_MESSAGE);
	}
	if (!row || !ok || !row.is_active) {
		if (row) {
			const failures = (row.is_locked ? 0 : row.failed_logins) + 1;
			if (failures >= MAX_FAILURES) {
				await db.query("UPDATE users SET failed_logins = 0, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?", [LOCK_MINUTES, row.id]);
				await recordAudit(null, auditAs(req, row, email), { action: "account_locked", entity: "user", entityId: row.id, label: email, after: { failures, lockMinutes: LOCK_MINUTES } });
			} else {
				await db.query("UPDATE users SET failed_logins = ? WHERE id = ?", [failures, row.id]);
				await recordAudit(null, auditAs(req, row, email), { action: "login_failed", entity: "user", entityId: row.id, label: email, after: { failures, remaining: MAX_FAILURES - failures } });
			}
		} else {
			await recordAudit(null, auditAs(req, null, email), { action: "login_failed", entity: "user", label: email });
		}
		throw unauthorized(GENERIC_MESSAGE);
	}

	await db.query("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?", [row.id]);
	return { id: row.id, token_version: row.token_version };
}

module.exports = { authenticate, GENERIC_MESSAGE, MAX_FAILURES, LOCK_MINUTES };
