const { facilityIdsWithRole } = require("./permissions");
const db = require("../config/db");

/**
 * Restriction d'accès par installation pour les requêtes de liste.
 * col = colonne SQL de l'identifiant d'installation (ex. « s.facility_id »).
 * Retourne { empty, where[], params[] } ; empty = l'utilisateur n'a accès à aucune installation.
 */
function scopeFor(user, col, minRole = "reader", facilityFilter = null) {
	const ids = facilityIdsWithRole(user, minRole);
	const where = [], params = [];
	if (ids && !ids.length) return { empty: true, where, params };
	if (ids) { where.push(`${col} IN (?)`); params.push(ids); }
	if (facilityFilter) { where.push(`${col} = ?`); params.push(Number(facilityFilter)); }
	return { empty: false, where, params };
}

/** Installation d'un actif (null si inexistant). */
async function facilityOfAsset(assetId, conn = db) {
	const [[r]] = await conn.query("SELECT s.facility_id FROM assets a JOIN systems s ON s.id = a.system_id WHERE a.id = ?", [assetId]);
	return r?.facility_id ?? null;
}

module.exports = { scopeFor, facilityOfAsset };
