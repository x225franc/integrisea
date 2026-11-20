import { reactive } from 'vue';

// Aucun jeton n'est stocké côté navigateur : la session vit dans des cookies httpOnly (inaccessibles au script de la page).
// Ce store ne garde que l'utilisateur affiché et ses droits ; la source de vérité reste le serveur.
const RANK = { reader: 1, inspector: 2, engineer: 3, admin: 4 };

export const auth = reactive({
	user: null,
	/** Restauration de la session (cookie existant) déjà tentée au démarrage. */
	restored: false,
	/** Installation sélectionnée dans le filtre global ('' = toutes). */
	facility: '',
	setSession(user) { this.user = user; this.restored = true; },
	async logout(expired = false) {
		// Révocation côté serveur (jeton de rafraîchissement) puis retour à l'écran de connexion.
		try { await fetch(`${__API_BASE__}/api/auth/logout`, { method: 'POST', credentials: 'include' }); } catch { /* serveur injoignable : session locale fermée quand même */ }
		this.user = null; this.facility = '';
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
