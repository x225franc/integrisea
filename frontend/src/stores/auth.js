import { reactive } from 'vue';

const KEY = 'integrisea_token';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* stockage indisponible */ } };

const RANK = { reader: 1, inspector: 2, engineer: 3, admin: 4 };

export const auth = reactive({
	token: read(),
	user: null,
	/** Installation sélectionnée dans le filtre global ('' = toutes). */
	facility: '',
	setSession(token, user) { this.token = token; this.user = user; write(token); },
	setToken(token) { this.token = token; write(token); },
	logout(expired = false) {
		this.token = null; this.user = null; this.facility = ''; write(null);
		if (location.pathname !== '/login') location.assign('/login' + (expired ? '?expired=1' : ''));
	},
	/** L'utilisateur a-t-il au moins `min` sur l'installation (administrateur = oui partout) ? */
	can(facilityId, min = 'engineer') {
		if (!this.user) return false;
		if (this.user.isAdmin) return true;
		const r = this.user.facilityRoles?.[facilityId];
		return !!r && RANK[r] >= RANK[min];
	},
	/** A-t-il au moins `min` sur une installation quelconque (pour afficher un bouton de création) ? */
	canAny(min = 'engineer') {
		if (!this.user) return false;
		return this.user.isAdmin || Object.values(this.user.facilityRoles || {}).some((r) => RANK[r] >= RANK[min]);
	},
});
