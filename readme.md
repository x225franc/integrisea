# IntegriSea

Application web de gestion de l'intégrité des actifs offshore (FPSO, plateformes de tête de puits) : registre des actifs, criticité, inspections, anomalies, RBI semi-quantitatif, stratégie de maintenance, pièces de rechange, documents, piste d'audit, exports GMAO.
Application originale : aucun nom, écran ou méthode propriétaire d'un éditeur n'est repris.

> ⚠️ **Logiciel lié à la sécurité.** Tous les calculs doivent être validés par des ingénieurs intégrité qualifiés avant toute utilisation opérationnelle. Un bandeau l'indique dans l'application (`SHOW_VALIDATION_WARNING`). La liste des choix à valider est dans [docs/hypotheses-a-valider.md](docs/hypotheses-a-valider.md).

## Structure

```
backend/           API Express (routes, middleware, services, scripts de migration/seed, tests)
frontend/          Vue 3 + Vite + vue-i18n (français par défaut, anglais)
packages/engine/   Moteur de calcul d'intégrité : pur, sans dépendance, testé (50 tests)
database/          migrations SQL datées + données de démonstration
docs/              notes d'avancement par étape, hypothèses de calcul à valider
prototype/         Maquette HTML d'origine (référence fonctionnelle, non utilisée par l'application)
```

## Démarrage (développement)

Prérequis : Node 22+, Docker.

```bash
npm run install:all     # dépendances (racine, backend, frontend)
npm run docker:up       # MySQL (port 3307) + phpMyAdmin (http://localhost:8088)
npm run db:migrate      # crée les tables
npm run db:seed         # classes, gabarits, administrateur + données de démonstration FICTIVES
npm run dev             # API (4000) + frontend (5173) ensemble
```

Puis ouvrir http://localhost:5173. L'administrateur est `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` du fichier `.env.development`. Les comptes de démonstration (`ingenieur.aur@…`, `inspecteur@…`, `lecteur.wha@…`, `@integrisea.local`) utilisent le même mot de passe.

Le frontend appelle l'API en relatif (`/api`) : le serveur Vite relaie vers le backend, sans CORS en développement.

## Commandes (depuis la racine)

| Commande | Effet |
|---|---|
| `npm run dev` | API + frontend en développement |
| `npm start` | idem, en installant les dépendances avant |
| `npm run build` | build de production du frontend (`frontend/dist`) |
| `npm run start:prod` | API + frontend avec `.env.production` |
| `npm test` | tests du moteur (50) et du backend (14) |
| `npm run test:e2e` | 125 vérifications de bout en bout : 51 fonctionnelles + 74 de sécurité et de configuration (API démarrée ; base de démonstration remise à zéro avant par `npm run db:reset`) |
| `npm run db:migrate` / `db:seed` / `db:reset` | base de données (`db:reset` interdit en production) |
| `npm run docker:up` / `docker:down` | MySQL + phpMyAdmin |
| `npm run docker:storage` | service S3 (RustFS), **facultatif** |
| `npm run docker:prod` | déploiement complet (nginx + API + MySQL + phpMyAdmin) |

## Environnements

`.env.development` et `.env.production` sont à la racine, **ignorés par git** ; seuls les `.example` sont versionnés. En production, le backend **refuse de démarrer** si un secret est manquant, vaut `change_me` ou si `JWT_SECRET` fait moins de 32 caractères.

## Authentification et sécurité

- **Aucun jeton dans le navigateur** : la session vit dans des **cookies httpOnly + SameSite=Strict**, protégés contre le CSRF (jeton lié à la session, en-tête `X-CSRF-Token`). Jeton d'accès de **15 minutes** + jeton de rafraîchissement **à rotation** (usage unique, 8 h glissantes, **session maximale absolue de 12 h**, révocable : la déconnexion coupe la session immédiatement ; un jeton rejoué révoque toute la session).
- **Verrouillage de compte** : 5 échecs consécutifs bloquent le compte 15 minutes (en plus de la limitation par IP) ; l'administrateur peut le déverrouiller. Échecs, verrouillages et déverrouillages sont dans la piste d'audit. Réglages : `LOGIN_MAX_FAILURES`, `LOGIN_LOCK_MINUTES`, `ACCESS_TOKEN_MINUTES`, `REFRESH_TOKEN_HOURS`, `SESSION_MAX_HOURS`. Un refus de connexion affiche toujours le même message (« Identifiants invalides ou compte temporairement verrouillé »).
- **HTTPS** : l'attribut `Secure` des cookies est **automatique** (actif dès que la connexion arrive en HTTPS, y compris derrière un proxy TLS avec `TRUST_PROXY=1`). Un cookie `Secure` est refusé par le navigateur en HTTP simple : en exploitation, servir l'application en HTTPS (`COOKIE_SECURE=true` pour le forcer).
- **SSO (OIDC / Azure AD) et double authentification** : non implémentés, mais l'architecture permet de les ajouter sans refonte (`backend/services/authProviders`, `backend/services/session.js`).

## Rôles et droits

| | Lecteur | Inspecteur | Ingénieur intégrité | Administrateur |
|---|---|---|---|---|
| Consulter (par installation) | ✔ | ✔ | ✔ | ✔ |
| Saisir inspections, créer des anomalies, cocher les actions | | ✔ | ✔ | ✔ |
| Modifier actifs, clôturer anomalies, nomenclatures, documents, piste d'audit | | | ✔ | ✔ |
| Utilisateurs, installations, configuration, gabarits | | | | ✔ |

Les droits sont attribués **par installation** (un utilisateur peut être ingénieur sur une installation et lecteur sur une autre).

## Stockage des fichiers

**Par défaut, les fichiers sont stockés sur le disque de la machine** (`STORAGE_DRIVER=local`) : dossier `backend/uploads` en développement, volume Docker `uploads_data` en déploiement. Aucun service supplémentaire. Pensez à sauvegarder ce volume avec la base de données.

Option : un stockage compatible S3 (`STORAGE_DRIVER=s3`, service Docker `s3` via `npm run docker:storage`, ou un S3 existant en renseignant `S3_*`). MinIO ne publie plus d'images publiques ; le service fourni utilise **RustFS** (S3 compatible). Test : `STORAGE_DRIVER=s3 node backend/tests/s3.smoke.js`.

## Déploiement (Docker Compose)

```bash
# 1. renseigner .env.production (tous les "change_me", URLs)
npm run docker:prod                      # construit et démarre : nginx (FRONTEND_PORT), API, MySQL, phpMyAdmin
docker compose --env-file .env.production exec backend node scripts/seed.js   # crée l'administrateur (1re fois)
```

Les migrations s'appliquent au démarrage du backend. En production le jeu de démonstration n'est pas chargé et la **table des contraintes admissibles est vide** : à renseigner dans Configuration › Matériaux avant d'obtenir des t_min. **HTTPS** : placer un reverse proxy TLS devant le conteneur `frontend` ([deploy/nginx-tls.conf.example](deploy/nginx-tls.conf.example)) et définir `FRONTEND_URL=https://…`, `TRUST_PROXY=1`. Ne pas exposer phpMyAdmin et la base sur Internet (limiter `PMA_PORT` / `DB_PORT` au réseau d'administration).

## Persistance et sauvegarde

Les données vivent dans deux **volumes Docker nommés**, indépendants des conteneurs : `db_data` (base MySQL) et `uploads_data` (fichiers). Ils survivent aux redémarrages, aux mises à jour (`docker compose up --build`) et à `docker compose down` (vérifié : conteneurs détruits puis recréés, données et fichiers intacts).

⚠️ Ils sont **supprimés** par `docker compose down -v`, par « Clean / Purge data » de Docker Desktop ou par la suppression manuelle du volume. Ne jamais utiliser `-v` sur une installation réelle, et **faire des sauvegardes** :

```bash
# Base de données (fichier .sql)
docker compose --env-file .env.production exec -T db sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction integrisea' > sauvegarde-base.sql

# Fichiers (archive .tgz)
docker run --rm -v integrisea_uploads_data:/data -v "$PWD":/backup alpine tar czf /backup/sauvegarde-fichiers.tgz -C /data .

# Restauration
docker compose --env-file .env.production exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" integrisea' < sauvegarde-base.sql
docker run --rm -v integrisea_uploads_data:/data -v "$PWD":/backup alpine tar xzf /backup/sauvegarde-fichiers.tgz -C /data
```

(Le préfixe `integrisea_` est le nom du projet Compose ; `docker volume ls` le confirme.) Copier ces deux fichiers sur un autre disque ou une autre machine régulièrement.

## Intégrations

- **Power BI** : vues SQL en lecture seule `v_bi_assets`, `v_bi_inspections`, `v_bi_anomalies` (créer un utilisateur MySQL en lecture seule sur ces vues).
- **GMAO (Maximo 7.6)** : Configuration › Exports GMAO (actifs et plans de maintenance préventive, XLSX/CSV). Mapping à confirmer avec l'équipe Maximo.
- **CSV/Excel** : bouton Exporter sur toutes les listes ; import des actifs avec modèle téléchargeable.

## Avancement

Les 6 étapes du cahier des charges sont réalisées — voir [docs/notes-etapes.md](docs/notes-etapes.md). La réponse du client aux hypothèses de calcul est prise en compte (valeurs **provisoires**, signalées dans l'interface) : voir [docs/notes-revue-hypotheses.md](docs/notes-revue-hypotheses.md). Restent à la charge du client : la validation des calculs, la matrice et les paramètres réels, le mapping Maximo, et les évolutions listées en fin de [docs/hypotheses-a-valider.md](docs/hypotheses-a-valider.md) (mode hors ligne, API 581…).
