# Note récapitulative — prise en compte de la réponse aux hypothèses

Réponse du client : [reponse-hypotheses.md](reponse-hypotheses.md). Détail de chaque décision : [hypotheses-a-valider.md](hypotheses-a-valider.md). Toutes les valeurs sont **provisoires** (phase de test), modifiables dans Configuration et signalées par une pastille « Provisoire » tant qu'un administrateur ne les a pas validées.

## Ce qui a changé

| § réponse | Changement | Où |
|---|---|---|
| 1.1 | Vitesse de corrosion et RL **par CML** (plus de « CML gouvernant » par inspection) ; RL de l'actif = plus faible RL_CML ; courbe avec une série par CML et tableau par CML dans la fiche | `packages/engine/src/corrosion.js`, `rbi.js` ; `ThicknessChart.vue`, `AssetDetail.vue` |
| 1.2 | Contraintes admissibles **matériau × température**, interpolation linéaire, **sans extrapolation** ; import / export Excel-CSV ; démo FICTIVE (−29 à 200 °C) | `thickness.js`, `backend/services/stressTable.js`, `Config.vue` |
| 1.3 | Appareils : formule au **rayon extérieur** `P·Ro/(S·E+0,4·P)`, viroles cylindriques seulement (dit dans le détail) | `thickness.js` |
| 1.4 | PoF par défaut d'un actif jamais inspecté : **4 si CoF ≥ 4, sinon 3** (configurable) | `rbi.js`, `config.js` |
| 1.5 | CoF inconnue : **5**, actif « incomplet » | `rbi.js` |
| 1.6 | **Grade → PoF** : 1→1, 2→2, 3→3, **4→5** (table configurable) | `rbi.js` |
| 1.7 | Tolérance de fabrication et surépaisseur de corrosion non intégrées : mentionné dans le détail | `thickness.js` |
| 2.1 | Valeurs conservées, **marquées provisoires** ; matrice « provisoire, à remplacer par la matrice société » ; épaisseurs structurelles **par plage de diamètre** | `settings.js`, `ProvisionalBadge.vue` |
| 2.2 | **Plancher de vitesse par famille de matériau** : 0,05 (acier carbone) / 0,01 (alliages résistants) mm/an, famille inconnue → carbone | `corrosion.js`, `Config.vue` |
| 3 | **Discipline** sur l'actif (défaut par classe, liste configurable), AMDE remplacée, **filtres** sur registre, planning, anomalies, RBI ; gabarit **Ex** à gravité par point de contrôle | migration 003, `grading.js`, vues |
| 4 | RL < 2 ans → **P1** ; alerte réparation temporaire **90 j** | `config.js` |
| 5 | **Cookies httpOnly + SameSite=Strict + CSRF** ; accès 15 min + rafraîchissement à rotation, révocable ; **verrouillage 5 échecs / 15 min** audité ; architecture SSO / 2FA prête (non implémentés) | migration 004, `services/session.js`, `services/authProviders/`, `middleware/auth.js`, `routes/auth.routes.js`, `api.js` |

## Migrations

- `2026_11_21_003_review_disciplines_validation.sql` : disciplines (classes, actifs, AMDE), colonnes de validation, suppression de l'ancien format de configuration, nouveau gabarit Ex.
- `2026_11_21_004_auth_sessions.sql` : verrouillage de compte, table `refresh_tokens`.
- `2026_11_21_005_review_section10.sql` : date de début de session (`session_started_at`), gabarit Ex à jour (point « enceinte et verre » scindé, modifications non autorisées critiques, gabarit repassé en provisoire), `grade4` → P1 dans la configuration enregistrée si elle valait encore P2.

## Tests

- **Moteur : 50 tests** (34 avant), au moins un exemple chiffré par règle : RL par CML (comparaison avec l'ancienne méthode, 22,0 → 19,6 ans au lieu de 66), interpolation de S (60 °C entre 150 et 130 MPa → 140 MPa ; 250 °C → non calculable), formule au rayon extérieur (48,28 mm, indépendante de l'épaisseur), PoF par défaut (CoF 3/4/5), CoF inconnue, grade 4 → PoF 5, planchers de vitesse (carbone, CRA, inconnu), gravité Ex, RL < 2 ans → P1, alerte 90 j.
- Backend : 14 tests unitaires (dont l'import de la table des contraintes).
- **Bout en bout : 51 + 74 vérifications** (`npm run test:e2e`) : sécurité (cookies, CSRF, rotation, rejeu, déconnexion, verrouillage, audit), validation des paramètres, import des contraintes, disciplines, détail par CML.
- Parcours navigateur (développement et production derrière nginx) : aucune erreur de console ni de réseau.

## Points restés en suspens (questions)

Voir §10 de [hypotheses-a-valider.md](hypotheses-a-valider.md). Les plus importants :

1. **`t_réf` d'un CML à une seule mesure** : j'ai pris `t_nom` depuis l'installation. À confirmer.
2. **Plafond « moitié de la RL »** : plus faible RL_CML ramenée à la date de la dernière mesure. À confirmer.
3. **EX** : discipline « Pressure Systems » provisoire.
4. *(Tranché)* Compte verrouillé : message générique partout.
5. **HTTPS** : l'attribut Secure est automatique ; en exploitation, l'application doit être servie en HTTPS.
6. **Valeurs réelles à fournir** : table des contraintes admissibles (matériau × température), matrice société, table des épaisseurs structurelles, mapping Maximo.

## Réponse à la section 10 (2026-11-21)

Points 1, 2, 3, 4, 5 et 9 acceptés tels quels. Appliqué :

- **Gabarit Ex** : « Modifications non autorisées » devient critique ; « enceinte et verre » est séparé en « corrosion ou dommage superficiel » (non critique) et « fissure, bris ou déformation » (critique). Le gabarit repasse en provisoire.
- **Session** : rafraîchissement de 8 h glissantes conservé, **plafond absolu de 12 h** (`SESSION_MAX_HOURS`, configurable), nouvelle connexion obligatoire ensuite.
- **Compte verrouillé** : message unique « Identifiants invalides ou compte temporairement verrouillé », code 401 identique, vérification du mot de passe même sur un compte verrouillé (temps de réponse identique) ; verrouillage visible de l'administrateur et dans la piste d'audit.
- **Anomalie suggérée** : grade 4 → **P1**.
- Tests : moteur 50/50, backend 14/14, bout en bout 51 + 74 (nouveaux : plafond de session, refus après 12 h, message identique, gabarit Ex, grade 4 → P1 dans les tests du moteur).
