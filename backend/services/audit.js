const db = require("../config/db");

/**
 * Enregistre une entrée dans la piste d'audit. À appeler avec la connexion de la transaction
 * pour que la modification et son audit réussissent ou échouent ensemble.
 */
async function recordAudit(conn, req, { action, entity, entityId, label, facilityId, before, after }) {
	const user = req?.user;
	await (conn || db).query(
		`INSERT INTO audit_log (user_id, user_email, action, entity, entity_id, entity_label, facility_id, before_json, after_json, ip)
		 VALUES (?,?,?,?,?,?,?,?,?,?)`,
		[
			user?.id ?? null,
			user?.email ?? null,
			action,
			entity,
			entityId != null ? String(entityId) : null,
			label ?? null,
			facilityId ?? null,
			before === undefined ? null : JSON.stringify(before),
			after === undefined ? null : JSON.stringify(after),
			req?.ip ?? null,
		],
	);
}

/** Différences champ à champ entre deux objets (pour ne journaliser que ce qui change). */
function diff(before, after) {
	const b = {}, a = {};
	for (const k of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
		if (JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])) {
			b[k] = before?.[k] ?? null;
			a[k] = after?.[k] ?? null;
		}
	}
	return { before: b, after: a, changed: Object.keys(a).length > 0 };
}

module.exports = { recordAudit, diff };
