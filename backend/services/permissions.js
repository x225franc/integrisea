// Droits : Administrateur (global) > Ingénieur intégrité > Inspecteur > Lecteur (ces trois derniers par installation).
const RANK = { reader: 1, inspector: 2, engineer: 3, admin: 4 };

/** user = { isAdmin, facilityRoles: { [facilityId]: 'reader'|'inspector'|'engineer' } } */
function roleOn(user, facilityId) {
	if (!user) return null;
	if (user.isAdmin) return "admin";
	return user.facilityRoles?.[facilityId] ?? null;
}

function hasRole(user, facilityId, minRole) {
	const r = roleOn(user, facilityId);
	return !!r && RANK[r] >= RANK[minRole];
}

/** Identifiants des installations où l'utilisateur a au moins minRole ; null = toutes (admin). */
function facilityIdsWithRole(user, minRole = "reader") {
	if (user.isAdmin) return null;
	return Object.entries(user.facilityRoles || {})
		.filter(([, r]) => RANK[r] >= RANK[minRole])
		.map(([id]) => Number(id));
}

module.exports = { RANK, roleOn, hasRole, facilityIdsWithRole };
