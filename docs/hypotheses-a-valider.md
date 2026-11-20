# Hypothèses de calcul et choix métier à faire valider

> ⚠️ **IntegriSea est un logiciel lié à la sécurité.** Aucun résultat ne doit être utilisé opérationnellement avant validation par des ingénieurs intégrité qualifiés. Ce document liste **tout ce qui a été décidé sans que le cahier des charges ne le précise**, pour que le client puisse trancher. Chaque valeur est modifiable dans **Configuration** (administrateur), sauf mention contraire.

Le cahier des charges demandait de poser des questions plutôt que d'inventer. Les points ci-dessous sont les choix faits faute de réponse ; les trois premiers (cas limites 3-4-5) ont été explicitement laissés à l'appréciation du développeur en attendant l'avis du client.

## 1. Cas limites du calcul (laissés au développeur)

| # | Situation | Règle retenue | Où |
|---|---|---|---|
| 3 | Aucune mesure d'épaisseur | PoF = 3 ; date de base = 1er juillet de l'année d'installation | `defaultPofNoData` |
| 3 | Une seule mesure | vitesse long terme seule | moteur |
| 3 | Vitesse négative ou nulle | ramenée au minimum 0,01 mm/an | `minCorrosionRate` |
| 3 | Épaisseur mesurée < t_min | RL = 0 (valeur brute conservée dans le détail), PoF 5, intervalle 0, anomalie P1 proposée | moteur |
| 4 | Équipement suivi par son état | PoF = grade de la dernière inspection notée ; sans inspection PoF 3 | moteur |
| 4 | PoF 5 | n'est atteint que par la RL < 2 ans ou par les modificateurs (+1) | moteur |
| 5 | Plafond « moitié de la RL » | appliqué **seulement** aux actifs suivis en épaisseur ; sinon max par risque et max par classe | moteur |

## 2. Formules et paramètres

- **Contraintes admissibles : table vide par défaut** (demande du client). Sans valeur pour un matériau, le t_min n'est **pas calculable** : l'actif est signalé « non calculable » (liste RBI, tableau de bord, fiche) et reçoit le PoF par défaut. **Aucune valeur n'est inventée.** Le jeu de démonstration contient 4 valeurs **fictives** (CS 138, 22Cr Duplex 207, 316L 115, CuNi 90/10 69 MPa) reprises du prototype ; elles ne sont **pas** chargées en production.
- **Tuyauteries et risers** : `t = P·D / (2·(S·E + P·Y))`, Y = 0,4, E = 1. **Appareils et échangeurs** : `t = P·R / (S·E − 0,6·P)`, E = 1, avec **R = D/2 − t_nom** (rayon intérieur nominal ; hypothèse issue du prototype, à confirmer). Pression de calcul en barg convertie en MPa (× 0,1) : pression manométrique.
- **Épaisseur structurelle minimale** : 2,0 mm pour tuyauterie de diamètre extérieur ≤ 114,3 mm (« DN ≤ 4" »), 2,8 mm au-delà ; **2,5 mm pour appareils et échangeurs** (valeur du prototype, absente du cahier des charges).
- **Mesure retenue** : à chaque inspection, la **plus faible épaisseur** parmi les CML (CML gouvernant).
- **Vitesse long terme** : `(t_nom − t_dernière) / années depuis le 1er juillet de l'année d'installation`, durée minimale 0,5 an. **Court terme** : entre les deux dernières mesures, durée minimale 0,25 an. On retient la plus élevée.
- **RL** : `(t_mesurée − t_min)/CR − années écoulées depuis la mesure`.
- **Seuils PoF/RL** : ≥ 20 → 1 ; 10–20 → 2 ; 5–10 → 3 ; 2–5 → 4 ; < 2 → 5 (borne basse incluse dans la classe supérieure).
- **Matrice 5×5 par défaut** : niveau selon la somme PoF + CoF (≤ 4 L, ≤ 6 M, ≤ 8 MH, sinon H) — valeur de départ du prototype, **à remplacer par la matrice du client**.
- **Intervalles par défaut** : L 96, M 60, MH 36, H 12 mois ; max par classe : Ex 36, PSV 36, flexibles 12, tubing 24.
- **Plafond « moitié de la RL »** calculé sur la RL **à la date de la dernière mesure** (l'intervalle court depuis cette inspection), exprimé en mois, minimum 0.
- **Retard** : le +1 de PoF « inspection en retard » est appliqué **après** le calcul de l'intervalle (pas de boucle) ; il modifie le risque final mais pas l'intervalle.
- **Anomalie P1/P2 ouverte** : +1 de PoF une seule fois, quel que soit le nombre d'anomalies ; plafonné à 5.
- **« Actifs à risque élevé »** du tableau de bord : niveau **H** uniquement (MH exclu).
- **Fin de vie** : RL < 10 ans **ou** anomalie P1/P2 ouverte. **Échéance proche** : 90 jours.

## 3. Criticité

- **Conséquence** CoF = max(S, E, P). Criticité A si une note ≥ 4, B si le maximum vaut 3, sinon C. SCE si S ≥ 4.
- **Notes par défaut selon le fluide** (11 fluides) et **échelles descriptives FR/EN** : valeurs de départ reprises du prototype, traduites ; configurables.
- Un actif sans note ni fluide connu reçoit CoF = 3 **et est signalé incomplet**.

## 4. Inspections et anomalies

- **Grade** (1–4) calculé par les règles du gabarit (règles données, modifiables) :
  - PSV : écart |ouverture − tarage| / tarage > 3 % → 3, > 10 % → 4 ; étanchéité du siège non conforme → ≥ 3 *(conforme au cahier des charges)* ;
  - structures : fissure → 4 *(cahier des charges)* ; **revêtement dégradé > 30 % → ≥ 3** *(seuil du prototype, absent du cahier des charges)* ;
  - Ex : grade selon le nombre de points non conformes (0→1, 1→2, 2→3, ≥3→4) *(échelle du prototype)* ;
  - tubing : raccords desserrés > 3 → ≥ 3, > 0 → ≥ 2 *(prototype)* ; flexibles et annulaire : point non conforme → ≥ 3.
- **Priorité d'anomalie suggérée** (proposition, jamais automatique) : épaisseur < t_min → P1 ; RL < 2 ans → P2 ; RL < 5 ans → P3 ; grade 4 → P2 ; grade 3 → P3 ; la plus urgente l'emporte. **Le cahier des charges ne donne que « P1 sous t_min »** : le reste est à valider.
- **Délais** P1 7 j, P2 30 j, P3 90 j, P4 365 j. **Alerte réparation temporaire** : 30 jours avant expiration.
- Les **libellés des champs des gabarits** sont des données (anglais, repris du prototype) : ils ne sont pas traduits automatiquement.

## 5. Données de démonstration

Fictives (FPSO Aurora, Wellhead Platform Alpha, 41 actifs, 89 inspections, 11 anomalies, 12 pièces, 47 documents, 26 lignes AMDE) : reprises du prototype. Chargées avec `npm run db:seed` hors production uniquement (`SEED_DEMO=1` pour forcer).

## 6. Export GMAO (Maximo 7.6)

Les en-têtes (ASSETNUM, SITEID, LOCATION, PMNUM, FREQUENCY, FREQUNIT, NEXTDATE…) suivent les noms d'attributs standard des objets ASSET et PM, mais **le mapping exact (sites, emplacements, classifications, plans de travail, statuts) est à confirmer avec l'équipe Maximo du client** — il est isolé dans `backend/routes/export.routes.js`.

## 7. Non implémenté / hors périmètre

- Moteur **API 580/581 quantitatif** (licence) : l'architecture le permet (`packages/engine` est isolé derrière `evaluateAsset`).
- **Mode hors ligne** de la saisie terrain (« phase ultérieure » au cahier des charges) : l'interface est utilisable sur tablette mais nécessite le réseau.
- **Gammes, tournées et prévision des charges** (« plus tard »).
- SSO / double authentification, verrouillage de compte par utilisateur (seule la limitation de débit par IP est en place), jetons de rafraîchissement : à décider selon la politique de sécurité du client.
- Le jeton de session est conservé dans le navigateur (stockage local) ; la politique CSP stricte limite le risque d'injection de scripts.
