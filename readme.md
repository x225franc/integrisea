# IntegriSea

Application web de gestion de l'intégrité des actifs offshore (FPSO, plateformes de tête de puits).
Application originale : aucun nom, écran ou méthode propriétaire d'un éditeur n'est repris.

> ⚠️ **Logiciel lié à la sécurité.** Tous les calculs doivent être validés par des ingénieurs intégrité qualifiés avant toute utilisation opérationnelle. Un bandeau l'indique dans l'application (`SHOW_VALIDATION_WARNING`).

## Structure

```
backend/           API Express (routes, middleware, services, scripts de migration/seed)
frontend/          Vue 3 + Vite + vue-i18n (FR par défaut, EN)
packages/engine/   Moteur de calcul d'intégrité, pur et testé (étape 2)
database/          migrations SQL datées + jeux de données de démonstration
prototype/         Maquette HTML d'origine (référence fonctionnelle, non utilisée par l'app)
```

## Démarrage (développement)

Prérequis : Node 22+, Docker.

```bash
npm run install:all     # dépendances (racine, backend, frontend)
npm run docker:up       # MySQL (port 3307) + phpMyAdmin (http://localhost:8088)
npm run db:migrate      # crée les tables
npm run db:seed         # classes, administrateur, FPSO Aurora / Wellhead Platform Alpha (données fictives)
npm run dev             # API (4000) + frontend (5173) ensemble
```

Puis ouvrir http://localhost:5173. Identifiants administrateur : `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` du fichier `.env.development`.

## Commandes (depuis la racine)

| Commande | Effet |
|---|---|
| `npm run dev` | API + frontend en développement |
| `npm start` | idem, en installant les dépendances avant |
| `npm run build` | build de production du frontend (`frontend/dist`) |
| `npm run start:prod` | API + frontend avec `.env.production` |
| `npm test` | tests du moteur et du backend |
| `npm run db:migrate` / `db:seed` / `db:reset` | base de données (`db:reset` interdit en production) |
| `npm run docker:up` / `docker:down` | MySQL + phpMyAdmin |
| `npm run docker:storage` | MinIO (stockage S3, utile à partir de l'étape 5) |
| `npm run docker:prod` | déploiement complet (backend + frontend nginx + base) |

## Environnements

`.env.development` et `.env.production` sont à la racine, **ignorés par git**. Seuls les `.example` sont versionnés. En production, le backend refuse de démarrer si un secret est manquant ou vaut `change_me`.

## Déploiement (Docker Compose)

```bash
# renseigner .env.production, puis :
npm run docker:prod
docker compose --env-file .env.production exec backend node scripts/seed.js   # crée l'administrateur (1re fois)
```

Les migrations s'appliquent au démarrage du backend. En production, le jeu de démonstration n'est pas chargé (sauf `SEED_DEMO=1`).

## MinIO (S3)

L'image `minio/minio` n'a pas pu être téléchargée depuis la machine de développement (accès refusé par les registres). Le service est dans le profil `storage` ; à lancer avec `npm run docker:storage` lorsque l'image est disponible. Il n'est pas nécessaire avant l'étape 5.

## Avancement

- [x] **Étape 1 — Socle** : schéma MySQL, authentification email/mot de passe, rôles et droits par installation, hiérarchie Installation → Système → Tag, registre des actifs (création, modification, archivage), classes et attributs configurables, import/export CSV et Excel, piste d'audit, i18n FR/EN.
- [ ] Étape 2 — Calculs (`packages/engine`)
- [ ] Étape 3 — Inspections et anomalies
- [ ] Étape 4 — Criticité, RBI, tableau de bord
- [ ] Étape 5 — Maintenance, pièces de rechange, documents
- [ ] Étape 6 — Configuration, export Maximo 7.6, durcissement, déploiement
