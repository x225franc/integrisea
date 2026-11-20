# Notes d'avancement par étape

Chaque étape : l'application démarre, les tests passent, courte note de ce qui a été fait. Les règles métier choisies sans précision du cahier des charges sont dans [hypotheses-a-valider.md](hypotheses-a-valider.md).

## Étape 1 — Socle
Schéma MySQL versionné (migrations datées), authentification email/mot de passe (hachage bcrypt, jetons signés, limitation de débit), **rôles** Administrateur / Ingénieur / Inspecteur / Lecteur avec **droits par installation**, hiérarchie Installation → Système → Tag, registre des actifs (création, modification, archivage), classes et attributs configurables (champ CFIHOS), **import et export CSV/Excel** (validation ligne par ligne, tout-ou-rien, aperçu avant import, protection contre l'injection de formules), piste d'audit écrite côté serveur, interface FR/EN.

## Étape 2 — Calculs (`packages/engine`)
Module **pur, sans dépendance ni accès base**, 34 tests unitaires avec exemples chiffrés : t_min (tuyauterie ASME B31.3 et virole), vitesses de corrosion long/court terme, durée de vie résiduelle, PoF/CoF, modificateurs, matrice 5×5, intervalles et plafonds, notation automatique des inspections (règles par gabarit), suggestion d'anomalie, règles d'anomalies, agrégats du tableau de bord. Chaque évaluation produit des **lignes explicatives** (code + paramètres) traduites par l'interface : le calcul est reproductible et expliqué ligne par ligne.

## Étape 3 — Inspections et anomalies
8 gabarits fournis et **configurables** (champs + règles de notation), saisie utilisable sur tablette (relevés par CML, grade calculé), planning (En retard / Dû sous 90 j / Planifié), **recalcul immédiat du risque** à chaque saisie, proposition d'anomalie, pièces jointes (contrôle du contenu réel du fichier), **rapport PDF généré et ajouté au registre documentaire**. Anomalies P1–P4 avec échéances, plan d'actions, statuts Ouverte → En cours → Clôturée (**clôture refusée tant qu'une action est ouverte**), registre des réparations temporaires avec alertes d'expiration.

## Étape 4 — Criticité, RBI et tableau de bord
Tableau de bord (KPIs, matrice 5×5 cliquable qui filtre la liste RBI, anomalies par priorité, réparations temporaires, RL les plus faibles, prochaines inspections, filtre par installation, recherche par tag), liste RBI filtrable, synthèse de criticité par système, fiche actif complète : criticité, **détail du calcul ligne par ligne**, courbe d'épaisseur avec projection, historique, anomalies, maintenance, pièces, documents. Le risque est mis en cache (`asset_risk`) et recalculé à chaque événement et chaque jour.

## Étape 5 — Maintenance, pièces, documents
Bibliothèque AMDE (CRUD), **stratégie recommandée par actif** (intervalle « RBI » = intervalle calculé), documents de stratégie **PDF et Word** par installation et par classe, liste des actifs en fin de vie. Catalogue de pièces, nomenclature liant pièces et tags, alerte de stock minimum. Registre documentaire avec versions conservées, fichiers stockés sur disque ou **S3** (RustFS), téléchargement soumis aux droits de l'installation.

## Étape 6 — Configuration, audit, exports, durcissement, déploiement
Écrans d'administration : matrice 5×5 éditable, intervalles (risque et classe), seuils de RL, contraintes admissibles, formules, épaisseurs minimales, gabarits, échelles de conséquence, règles par fluide, délais, seuils. **Chaque modification est auditée (avant/après) et recalcule immédiatement tous les risques.** Exports CSV/Excel de toutes les listes, **export Maximo 7.6** (actifs et plans PM), **vues SQL pour Power BI** (`v_bi_assets`, `v_bi_inspections`, `v_bi_anomalies`). Durcissement : en-têtes de sécurité (helmet, CSP stricte côté nginx), limitation de débit globale et sur la connexion, validation de toutes les entrées, requêtes paramétrées, aucun secret dans le code (refus de démarrer en production avec des secrets par défaut), fichiers contrôlés et servis avec `nosniff` + sandbox. Déploiement Docker Compose (application, MySQL, phpMyAdmin, S3) validé de bout en bout.

## Revue des hypothèses (après les 6 étapes)
Application de la réponse du client aux hypothèses de calcul : RL et vitesse par CML, contraintes matériau × température, formule des appareils au rayon extérieur, PoF par défaut, CoF inconnue, grade → PoF, plancher de vitesse par famille, disciplines et filtres, gabarit Ex à gravité par point, session par cookies avec CSRF, rotation et verrouillage de compte. Toutes les valeurs sont **provisoires** et signalées comme telles. Voir [notes-revue-hypotheses.md](notes-revue-hypotheses.md) et [hypotheses-a-valider.md](hypotheses-a-valider.md).

## Vérifications effectuées
*(chiffres des étapes 1 à 6 ; après la revue : 50 tests du moteur, 14 du backend, 51 + 71 vérifications de bout en bout)*
- `npm test` : 34 tests du moteur + 11 tests du backend.
- `npm run test:e2e` (API + base de démonstration) : 51 vérifications, dont les 5 critères d'acceptation du cahier des charges.
- Parcours d'interface pilotés dans un navigateur (16 écrans, saisie d'inspection, anomalie suggérée, clôture bloquée, FR/EN, matrice, documents, PDF, tablette) : aucune erreur.
- Pile de production Docker (nginx + API + MySQL + S3, base vierge) : 18 vérifications + parcours d'interface, aucune erreur.
