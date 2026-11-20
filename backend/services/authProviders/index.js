// Architecture d'authentification extensible (SSO et double authentification NON implémentés pour l'instant).
//
//   1. un FOURNISSEUR prouve l'identité (mot de passe aujourd'hui ; OIDC / Azure AD demain) → { id, token_version }
//   2. un SECOND FACTEUR éventuel est exigé (TOTP, clé de sécurité…) — point d'insertion ci-dessous
//   3. issueSession() ouvre la session (cookies, jeton de rafraîchissement, CSRF) — indépendante des étapes 1 et 2
//
// Ajouter l'OIDC = nouveau fichier ici + une route de rappel (callback) qui appelle issueSession() ; aucune autre couche ne change.
// Ajouter la double authentification = implémenter requireSecondFactor() (état « en attente du code » entre 1 et 3).
const password = require("./password");

const providers = { password };

/**
 * Point d'extension de la double authentification : appelé après un fournisseur, avant l'ouverture de session.
 * Aujourd'hui aucun second facteur n'est configuré : l'identité est acceptée telle quelle.
 */
async function requireSecondFactor(/* req, identity */) {
	return { ok: true };
}

module.exports = { providers, requireSecondFactor };
