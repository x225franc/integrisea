# Hypothèses de calcul et choix métier à faire valider

> ⚠️ **IntegriSea est un logiciel lié à la sécurité.** Aucun résultat ne doit être utilisé opérationnellement avant validation par des ingénieurs intégrité qualifiés.
>
> **Phase de test.** Toutes les valeurs ci-dessous sont des **valeurs provisoires fondées sur les bonnes pratiques**, posées pour pouvoir tester l'application. Elles sont toutes marquées **« provisoire — à arbitrer »**. Elles restent **modifiables dans Configuration** (administrateur) et l'interface les signale par une pastille **Provisoire** (écran Configuration, matrice du tableau de bord, de la liste RBI et de la fiche actif) **tant qu'un administrateur ne les a pas validées** ; toute modification d'un paramètre le repasse en « provisoire ». L'avertissement « non validé pour usage opérationnel » reste affiché.
>
> Dernière mise à jour : prise en compte de la réponse du client ([reponse-hypotheses.md](reponse-hypotheses.md)). Note récapitulative : [notes-revue-hypotheses.md](notes-revue-hypotheses.md).

## 1. Corrections du moteur de calcul

| # | Situation | Décision | Statut |
|---|---|---|---|
| 1.1 | Vitesse de corrosion et durée de vie résiduelle | **Calculées pour chaque CML** (plus de « CML gouvernant » par inspection : comparer des emplacements différents n'a pas de sens). Long terme : `(t_réf − t_dernière) / durée` ; court terme : entre les deux dernières mesures **du même CML** ; **CR_CML = la plus élevée des deux, avec le plancher du §2.2**. `RL_CML = (t_dernière − t_min) / CR_CML − années écoulées depuis la mesure`. **RL de l'actif = la plus faible RL_CML**, le CML qui la donne est le **CML gouvernant** (affiché avec son épaisseur et sa vitesse). Un CML est identifié par son libellé (casse ignorée). | provisoire — à arbitrer |
| 1.1 | Épaisseur de référence `t_réf` | **Première mesure du CML** (mesure de référence) quand le CML a au moins deux mesures ; sinon **`t_nom` à compter du 1er juillet de l'année d'installation**. Un CML à une seule mesure, sans `t_nom` ni année d'installation, n'a pas de référence : il ne sert qu'à l'inspection suivante. Durées minimales : 0,5 an (long terme) et 0,25 an (court terme). | provisoire — à arbitrer |
| 1.1 | Courbe d'épaisseur | Une série par CML, le CML gouvernant en évidence (trait épais), projection du CML gouvernant jusqu'à `t_min`. | — |
| 1.2 | Contraintes admissibles | Table **matériau × température** (S en MPa pour plusieurs températures), **interpolation linéaire** à la température de calcul de l'actif. **Pas d'extrapolation** : hors de la plage renseignée, matériau absent ou température de calcul absente → actif **« non calculable »**. **Production : table vide.** Démonstration : 4 valeurs **FICTIVES** appliquées de −29 °C à 200 °C, étiquetées FICTIVES. **Import / export Excel ou CSV** (colonnes `material`, `temp_c`, `s_mpa`, `family`) : aperçu avant import, erreurs par ligne, remplacement de la table, journalisé. | provisoire — à arbitrer (valeurs réelles à fournir) |
| 1.3 | Appareils à pression | **Formule au rayon extérieur** (ASME VIII Div. 1, appendice 1-1) : `t = P·Ro / (S·E + 0,4·P)`, `Ro = D/2`. Indépendante de l'épaisseur : valable quand la paroi s'amincit. **Viroles cylindriques uniquement** (fonds et éléments coniques hors périmètre) : rappelé dans le détail du calcul. Tuyauteries : `t = P·D / (2·(S·E + P·Y))`, Y = 0,4, E = 1 (inchangé). Pression de calcul en barg convertie en MPa (× 0,1). | provisoire — à arbitrer |
| 1.4 | Actif jamais inspecté (ou sans donnée exploitable) | **PoF par défaut = 4 si CoF ≥ 4, sinon 3** (configurable : seuil de CoF, PoF haute, PoF basse). Le détail indique « aucune inspection — PoF par défaut conservateur ». Date de base de l'échéance : 1er juillet de l'année d'installation. | provisoire — à arbitrer |
| 1.5 | Conséquence inconnue | Actif sans note de conséquence et sans fluide connu : **CoF = 5** (au lieu de 3), actif signalé **« incomplet »** (tableau de bord, liste RBI, fiche). | provisoire — à arbitrer |
| 1.6 | Équipements suivis par leur état | **Grade → PoF : 1→1, 2→2, 3→3, 4→5** (table configurable). Le grade 4 (« action immédiate ») atteint PoF 5 sans modificateur. Sans inspection notée : PoF par défaut (§1.4). | provisoire — à arbitrer |
| 1.7 | Tolérance de fabrication, surépaisseur de corrosion | **Non intégrées dans `t_min`** (choix volontaire), mentionné dans le détail du calcul. La mesure de référence (§1.1) réduit l'effet de la tolérance de fabrication. | provisoire — à arbitrer |
| — | Épaisseur mesurée < `t_min` | `RL = 0` (valeur brute conservée dans le détail), PoF 5, intervalle 0, anomalie **P1** proposée. Détecté sur **n'importe quel CML**, pas seulement le CML gouvernant. | accepté |

## 2. Paramètres du calcul (valeurs provisoires)

| Paramètre | Valeur | Statut |
|---|---|---|
| Matrice 5×5 | somme PoF + CoF (≤ 4 L, ≤ 6 M, ≤ 8 MH, sinon H) — **« matrice provisoire, à remplacer par la matrice société »** (affichée comme telle) | provisoire — à arbitrer |
| Seuils PoF / RL | ≥ 20 → 1 ; 10–20 → 2 ; 5–10 → 3 ; 2–5 → 4 ; < 2 → 5 (borne basse incluse dans la classe supérieure) | provisoire — à arbitrer |
| Intervalles maximum par risque | L 96, M 60, MH 36, H 12 mois | provisoire — à arbitrer |
| Intervalles maximum par classe | Ex 36, PSV 36, flexibles 12, tubing 24 mois | provisoire — à arbitrer |
| Plafond « moitié de la RL » | **seulement** pour les actifs suivis en épaisseur ; RL de l'actif ramenée à la date de la dernière mesure (la plus faible RL_CML à cette date), en mois, minimum 0 | provisoire — à arbitrer |
| Modificateurs de PoF | +1 inspection en retard (appliqué **après** le calcul de l'intervalle, sans boucle) ; +1 anomalie P1/P2 ouverte (**une seule fois**) ; PoF plafonné à 5 | provisoire — à arbitrer |
| Épaisseurs structurelles minimales | Tuyauteries : **table par plage de diamètre extérieur** (≤ 114,3 mm : 2,0 ; au-delà : 2,8 — plages ajoutables) ; appareils : 2,5 mm | provisoire — à arbitrer (sera remplacée par la table société) |
| **Plancher de vitesse de corrosion** (§2.2) | **Acier carbone et faiblement allié : 0,05 mm/an ; alliages résistants à la corrosion (duplex, inox 316L, CuNi…) : 0,01 mm/an**. Appliqué à chaque CR_CML. Famille inconnue → acier carbone (conservateur). La famille de chaque matériau se saisit avec la table des contraintes. | provisoire — à arbitrer |
| Notes de conséquence par défaut selon le fluide, échelles descriptives S/E/P | 11 fluides, échelles FR/EN (valeurs de départ du prototype) | provisoire — à arbitrer |
| « Actifs à risque élevé » du tableau de bord | niveau **H** uniquement (MH exclu) | accepté |
| Fin de vie | RL < 10 ans **ou** anomalie P1/P2 ouverte ; échéance proche : 90 jours | accepté |

## 3. Criticité

- **Conséquence** CoF = max(S, E, P). Criticité A si une note ≥ 4, B si le maximum vaut 3, sinon C. SCE si S ≥ 4.
- Sans note ni fluide connu : CoF = 5, actif « incomplet » (§1.5).

## 4. Disciplines (nouveau)

Champ **discipline** sur l'actif (liste configurable : *Pressure Systems*, *Structural*, *Pipelines*). **Valeur par défaut portée par la classe**, modifiable sur chaque actif et pour chaque classe :

| Classe | Discipline par défaut |
|---|---|
| PV, HX, PSV, PIPE (procédé topsides), SBT, HOSE | Pressure Systems |
| STR (jacket, nœuds, ponts, helideck, coque, boat landing, conductors) | Structural |
| RISER, lignes d'export ou sous-marines | Pipelines |
| **EX** | **Pressure Systems — provisoire, discipline à confirmer** |

- Bibliothèque AMDE : Integrity / Mechanical / Instrument → **Pressure Systems** ; Structural → **Structural** ; Subsea → **Pipelines** ; Electrical → **Pressure Systems (provisoire)**.
- **Filtre par discipline** sur le registre des actifs, le planning d'inspection, les anomalies et la liste RBI (le tableau de bord l'accepte aussi côté API). Colonne `discipline` dans l'import/export des actifs (vide = défaut de la classe).
- Statut : provisoire — à arbitrer.

## 5. Inspections et anomalies

- **Grade** (1–4) calculé par les règles du gabarit (données, modifiables) :
  - **Ex : gravité par point de contrôle.** Point **critique** non conforme → grade ≥ 3 (certificat ou marquage incompatible avec la zone, chemin de flamme ou fixations, presse-étoupes, mise à la terre et liaisons équipotentielles, **modifications non autorisées**, **fissure, bris ou déformation de l'enceinte ou du verre**) ; autre point non conforme (**corrosion ou dommage superficiel** de l'enceinte ou du verre) → ≥ 2 ; **3 points non conformes ou plus → 4**. La gravité de chaque point est portée par le gabarit (`sev: "critical"`), règle `severityFail`.
  - PSV : écart |ouverture − tarage| / tarage > 3 % → 3, > 10 % → 4 ; étanchéité du siège non conforme → ≥ 3 *(conforme au cahier des charges)*.
  - Structures : fissure → 4 *(cahier des charges)* ; revêtement dégradé > 30 % → ≥ 3.
  - Tubing : raccords desserrés > 3 → ≥ 3, > 0 → ≥ 2 ; flexibles et annulaire : un point non conforme → ≥ 3.
  - Statut : provisoire — à arbitrer ; les gabarits portent leur propre pastille de validation.
- **Priorité d'anomalie suggérée** (proposition, jamais automatique ; la plus urgente l'emporte) : épaisseur < `t_min` → **P1** ; **RL < 2 ans → P1** *(modifié, était P2)* ; RL < 5 ans → P3 ; **grade 4 → P1** *(modifié, était P2 : cohérent avec « action immédiate » et la PoF 5)* ; grade 3 → P3. Provisoire — à arbitrer.
- **Délais cibles** P1 7 j, P2 30 j, P3 90 j, P4 365 j (inchangés).
- **Alerte avant expiration d'une réparation temporaire : 90 jours** *(modifié, était 30)* : temps d'étudier et planifier la réparation définitive.
- Les libellés des champs des gabarits sont des données (anglais, repris du prototype) : ils ne sont pas traduits automatiquement.

## 6. Sécurité et informatique

| Sujet | Décision |
|---|---|
| Jeton de session | **Plus de stockage local du navigateur.** Cookies **httpOnly**, **SameSite=Strict**, **Secure** (voir ci-dessous), protection **CSRF** (jeton lié à la session, en-tête `X-CSRF-Token`, sur toutes les requêtes qui modifient des données). Aucun jeton dans le corps des réponses ni lisible par le script de la page. |
| Durée | **Jeton d'accès 15 min** + **jeton de rafraîchissement avec rotation** (usage unique, valable 8 h glissantes, révocable) **et durée de session maximale absolue de 12 h** (`SESSION_MAX_HOURS`, configurable) : le renouvellement ne la dépasse jamais, une nouvelle connexion est obligatoire ensuite. Un jeton déjà utilisé qu'on rejoue révoque toute la session et est inscrit dans la piste d'audit. **Message de refus unique** « Identifiants invalides ou compte temporairement verrouillé » (même code 401, même message, même temps de réponse pour un mauvais mot de passe, un compte inconnu ou un compte verrouillé : aucun compte n'est révélé). Déconnexion = révocation immédiate (la session est vérifiée à chaque requête). Changement ou réinitialisation de mot de passe = toutes les sessions révoquées. |
| Attribut Secure | **Automatique** : activé quand la connexion arrive réellement en HTTPS (y compris derrière un proxy TLS, `TRUST_PROXY=1`), absent en HTTP simple. Un cookie `Secure` est refusé par le navigateur en HTTP (hors localhost) : le forcer sur une installation accessible en HTTP ferait échouer silencieusement la connexion. `COOKIE_SECURE=true` le force. **En exploitation : placer l'application derrière HTTPS.** |
| Verrouillage de compte | **5 échecs consécutifs → blocage de 15 minutes** de ce compte (en plus de la limitation par adresse IP). Échecs, verrouillage, tentatives sur compte verrouillé (visibles uniquement de l'administrateur et dans l'audit), déverrouillage manuel (administrateur) et rejeu de jeton sont **inscrits dans la piste d'audit**. |
| SSO (OIDC / Azure AD) et double authentification | **Non implémentés** (hors périmètre pour l'instant). **L'architecture permet de les ajouter sans refonte** : fournisseur d'identité → second facteur éventuel → ouverture de session sont trois couches séparées (`backend/services/authProviders`, `backend/services/session.js`). Ajouter l'OIDC = un nouveau fournisseur + une route de rappel qui appelle `issueSession()` ; ajouter le second facteur = implémenter `requireSecondFactor()`. |
| Export Maximo | Mapping isolé (`backend/routes/export.routes.js`), **« à confirmer avec l'équipe Maximo »**. Aucun autre changement. |

## 7. Données de démonstration

Fictives (FPSO Aurora, Wellhead Platform Alpha, 41 actifs, 89 inspections, 11 anomalies, 12 pièces, 47 documents, 26 lignes AMDE) : reprises du prototype. Chargées avec `npm run db:seed` hors production uniquement (`SEED_DEMO=1` pour forcer). Les contraintes admissibles de démonstration sont **FICTIVES** (CS 138, 22Cr Duplex 207, 316L 115, CuNi 90/10 69 MPa, −29 à 200 °C).

## 8. Export GMAO (Maximo 7.6)

Les en-têtes (ASSETNUM, SITEID, LOCATION, PMNUM, FREQUENCY, FREQUNIT, NEXTDATE…) suivent les noms d'attributs standard des objets ASSET et PM, mais **le mapping exact (sites, emplacements, classifications, plans de travail, statuts) est à confirmer avec l'équipe Maximo du client**.

## 9. Non implémenté / hors périmètre

- Moteur **API 580/581 quantitatif** (licence) : l'architecture le permet (`packages/engine` est isolé derrière `evaluateAsset`).
- **Mode hors ligne** de la saisie terrain, **gammes, tournées et prévision des charges**.
- **SSO / double authentification** (architecture prête, voir §6).

## 10. Choix que j'ai faits pour appliquer la réponse — à confirmer

Ces points n'étaient pas tranchés par la réponse ; j'ai retenu l'option la plus prudente pour pouvoir tester. Chacun reste modifiable et figure aussi dans la note récapitulative.

1. **`t_réf` d'un CML à une seule mesure** = `t_nom` au 1er juillet de l'année d'installation (la « première mesure » ne peut pas servir de référence à elle-même). Avec deux mesures ou plus, `t_réf` = première mesure du CML.
2. **Plafond « moitié de la RL »** : RL de l'actif ramenée à la date de la dernière mesure = la plus faible `RL_CML` à cette date.
3. **Épaisseur mesurée sous `t_min`** sur un CML non gouvernant : PoF forcé à 5 et anomalie P1 proposée (cohérent avec le §6 de la réponse).
4. **Température de calcul absente** sur un actif suivi en épaisseur : actif « non calculable » (aucune température inventée).
5. **Validation des paramètres** : un paramètre devient « provisoire » dès qu'il est modifié et ne redevient « validé » que par une action explicite d'un administrateur (journalisée). Les familles de matériaux suivent la table des contraintes, les coefficients ASME (Y, E) suivent les formules par classe.
6. **Gravité des points Ex** — *arbitré* : critiques = marquage/certificat, chemin de flamme et fixations, presse-étoupes, mise à la terre, **modifications non autorisées**, **fissure, bris ou déformation de l'enceinte ou du verre** ; non critique = **corrosion ou dommage superficiel** de l'enceinte ou du verre (l'ancien point « enceinte et verre » est séparé en deux). Le gabarit se modifie par son éditeur JSON.
7. **Jeton de rafraîchissement** — *arbitré* : 8 h glissantes, **plafonnées par une session maximale absolue de 12 h** (configurable) ; délai de grâce de 10 s avant de considérer un rejeu comme un vol (deux onglets qui rafraîchissent ensemble).
8. **Compte verrouillé** — *arbitré* : message générique partout (« Identifiants invalides ou compte temporairement verrouillé »), même code 401 que pour un échec normal ; le verrouillage reste visible de l'administrateur (liste des utilisateurs) et dans la piste d'audit. Contrepartie : un utilisateur légitime verrouillé n'est pas informé directement de la cause.
9. **Ancienne configuration** : les valeurs enregistrées dans l'ancien format (contraintes par matériau seul, deux plafonds structurels, PoF par défaut unique, plancher unique) sont supprimées à la migration (elles restent dans la piste d'audit) : le format a changé et aucune valeur ne doit être convertie de manière approximative.
