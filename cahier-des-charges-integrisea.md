# Cahier des charges : application de gestion de l'intégrité des actifs (offshore)

> **Pour Claude Code.** Ce document décrit l'application à développer. Lis-le en entier avant de commencer. Propose d'abord un plan d'architecture et un découpage en étapes, puis attends ma validation avant d'écrire le code.

---

## 1. Contexte

Je travaille dans l'intégrité des actifs offshore. Je veux une application web de gestion de l'intégrité des actifs (AIMS) du même type que BuildME de Petrofac (son module d'inspection et d'intégrité en particulier).

**Important : ce doit être une application originale.** Ne pas reprendre le nom, la marque, les écrans ni les méthodes propriétaires de Petrofac ou d'un autre éditeur. On s'inspire uniquement des fonctionnalités générales du marché.

Un **prototype HTML** (« IntegriSea », un seul fichier, données fictives) existe déjà et sert de référence pour les fonctionnalités et l'ergonomie. S'il est fourni (`index.html`), sers-t'en comme maquette fonctionnelle. Ne réutilise pas son code tel quel : il faut une vraie architecture.

## 2. Objectif

Passer du prototype à une **application déployable** :
- multi-utilisateurs, avec authentification et rôles ;
- données dans une vraie base de données, avec historique et piste d'audit ;
- calculs d'intégrité dans un module testé et documenté ;
- déploiement sur nos propres serveurs ou notre cloud (Docker).

## 3. Périmètre des actifs

Installations à couvrir :
- **FPSO** : modules topsides (séparation, compression gaz, injection d'eau, traitement de l'eau de production, production d'énergie et fuel gas), coque et systèmes marins, turret et swivel.
- **Plateformes de tête de puits (WHP)** : procédé topsides, jacket et structures, risers et conductors.

Classes d'équipements :

| Code | Classe | Suivi |
|---|---|---|
| PIPE | Tuyauteries de procédé | Épaisseur (UT) |
| PV | Appareils à pression | Épaisseur (UT) + inspection visuelle interne |
| HX | Échangeurs | Épaisseur + contrôle par courants de Foucault (tubes) |
| PSV | Soupapes de sécurité | Banc d'essai |
| RISER | Risers rigides / flexibles | Épaisseur (rigides) ou test d'annulaire (flexibles) |
| STR | Structures (jacket, nœuds, ponts, helideck, coque, boat landing, conductors) | État (grade 1–4) |
| EX | Matériel Ex | Inspection Ex (IEC 60079-17) |
| HOSE | Flexibles | Inspection + épreuve |
| SBT | Tubing de petit diamètre | Inspection |

La liste des classes doit être **configurable**.

## 4. Modules fonctionnels (tous requis)

### 4.1 Tableau de bord
- Indicateurs clés : nombre d'actifs, actifs de criticité A, inspections en retard, inspections dues sous 90 jours, anomalies ouvertes (dont P1/P2), actifs à risque élevé.
- Matrice de risque 5×5 avec le nombre d'actifs par case. Un clic sur une case filtre la liste RBI.
- Anomalies ouvertes par priorité, réparations temporaires et leur date d'expiration.
- Actifs à plus faible durée de vie résiduelle, prochaines inspections.
- Filtre global par installation et recherche par tag.

### 4.2 Registre des actifs
- Hiérarchie Installation → Système fonctionnel → Tag (les systèmes sont modifiables).
- Attributs : tag, description, classe, fluide, matériau, pression et température de calcul, diamètre extérieur, épaisseur nominale, année d'installation, mécanismes de dégradation.
- Codes de classe et attributs configurables, alignés si possible sur **CFIHOS**.
- Création, modification et archivage d'actifs. Import et export CSV/Excel.
- Fiche actif : attributs, criticité, évaluation RBI détaillée, courbe d'épaisseur, historique des inspections, anomalies, tâches de maintenance, pièces de rechange, documents.

### 4.3 Criticité
- Notes de conséquence de 1 à 5 sur trois axes : Sécurité (S), Environnement (E), Production (P), avec une échelle descriptive configurable.
- Criticité **A** si une note est ≥ 4, **B** si la plus haute vaut 3, sinon **C**.
- Élément critique pour la sécurité (SCE) si S ≥ 4.
- Valeurs par défaut selon le fluide ou le service (règles configurables), modifiables actif par actif.
- Synthèse par système fonctionnel.

### 4.4 Inspections
- **Gabarits d'inspection configurables** (champs de type relevés d'épaisseur par CML, grade 1–4, liste, nombre, conforme/non conforme, texte). Gabarits fournis :
  - Mesure d'épaisseur UT (relevés par CML)
  - Inspection visuelle générale
  - Inspection Ex détaillée (IEC 60079-17)
  - Banc d'essai PSV (pression de tarage, pression d'ouverture constatée, étanchéité du siège)
  - Inspection visuelle rapprochée des structures (grade, % de revêtement dégradé, indications de fissures)
  - Inspection et épreuve des flexibles
  - Test d'annulaire de riser flexible
  - Inspection du tubing de petit diamètre
- Calcul automatique du grade à partir des résultats : un champ non conforme donne un grade ≥ 3 ; PSV : écart > 3 % donne 3, > 10 % donne 4 ; fissure donne 4, etc.
- Planning d'inspection calculé par le RBI (voir 4.6), avec les statuts En retard / Dû sous 90 j / Planifié.
- Enregistrement d'une inspection : recalcul immédiat du risque et de la date suivante. Si un constat est grave (épaisseur sous t_min, durée de vie résiduelle < 5 ans, grade ≥ 3), l'application propose de créer une anomalie avec une priorité suggérée.
- Pièces jointes (photos, rapports PDF) et génération d'un rapport d'inspection.
- **Saisie terrain** : interface utilisable sur tablette ; un mode hors ligne est souhaitable dans une phase ultérieure.

### 4.5 Anomalies
- Priorités et délais cibles : P1 = 7 j, P2 = 30 j, P3 = 90 j, P4 = 12 mois (configurables).
- Statuts : Ouverte → En cours → Clôturée. La clôture n'est possible que si toutes les actions sont terminées.
- Plan d'actions (action, responsable, échéance, fait ou non).
- Registre des réparations temporaires (type, date d'expiration, alertes avant expiration).
- Une anomalie P1 ou P2 ouverte augmente la probabilité de défaillance (PoF) de l'actif de 1.

### 4.6 RBI et risque (semi-quantitatif)
Matrice 5×5 configurable : PoF de 1 à 5 en lignes, CoF de 1 à 5 en colonnes, niveaux L / M / MH / H.

**Équipements suivis en épaisseur :**
- t_min est l'épaisseur requise par le calcul de pression :
  - tuyauteries et risers : ASME B31.3 pour une tuyauterie droite, `t = P·D / (2·(S·E + P·Y))`, avec Y = 0,4 et E = 1 ;
  - appareils et échangeurs : virole cylindrique, `t = P·R / (S·E − 0,6·P)`.
- On applique ensuite une épaisseur minimale structurelle (valeurs configurables, par exemple 2,0 mm pour DN ≤ 4" et 2,8 mm au-delà).
- Les contraintes admissibles par matériau sont dans une table configurable.
- Vitesse de corrosion long terme (depuis l'installation) et court terme (entre les deux dernières mesures). On retient la plus élevée (minimum 0,01 mm/an).
- Durée de vie résiduelle : `RL = (t_mesurée − t_min) / CR − temps écoulé depuis la mesure`.
- PoF selon RL : ≥ 20 ans → 1 ; 10–20 → 2 ; 5–10 → 3 ; 2–5 → 4 ; < 2 → 5.

**Équipements suivis par leur état :** PoF = grade de la dernière inspection. Sans inspection, PoF = 3.

**Modificateurs :** +1 si une anomalie P1/P2 est ouverte ; +1 si l'inspection est en retard (confiance réduite). Le PoF est plafonné à 5.

**CoF** = max(S, E, P).

**Intervalle d'inspection :**
- maximum par niveau de risque, configurable (par défaut L = 96 mois, M = 60, MH = 36, H = 12) ;
- plafonné à la moitié de la durée de vie résiduelle ;
- plafonné aussi par un maximum par classe (par exemple Ex = 36 mois, flexibles = 12 mois).

Chaque actif doit afficher le **détail du calcul**, ligne par ligne (pourquoi tel PoF, tel plafonnement, etc.).

Il faut aussi un générateur de stratégie d'inspection : la méthode recommandée pour chaque actif, tirée de la bibliothèque de stratégies.

> ⚠️ **Ne pas implémenter API 581 quantitatif de mémoire.** Ce référentiel est sous licence. Prévoir une architecture permettant d'ajouter plus tard un moteur API 580/581 validé.

### 4.7 Stratégie de maintenance
- Bibliothèque de modes de défaillance (AMDE/FMEA) par classe : mode de défaillance, mécanisme, effet, tâche, méthode, intervalle (fixe ou « RBI »), discipline.
- Ajout, modification et suppression de lignes.
- Génération d'un document de stratégie (Word/PDF) par classe et par installation.
- Liste des actifs en fin de vie à revoir (RL < 10 ans ou anomalie P1/P2 ouverte).
- Plus tard : construction des gammes et des tournées, prévision des charges.

### 4.8 Matériels et pièces de rechange
- Catalogue (code, description, catégorie, criticité de la pièce, stock, stock minimum).
- Nomenclature (BoM) qui lie les pièces aux tags. Alerte quand le stock passe sous le minimum.

### 4.9 Registre documentaire
- Documents liés aux tags (P&ID, isométriques, fiches techniques, certificats Ex, plans de structure, rapports, plans de gestion de l'intégrité), avec numéro, titre, type et révision.
- Stockage des fichiers et gestion des versions. Les rapports d'inspection sont ajoutés automatiquement.

### 4.10 Configuration (administrateur)
- Matrice de risque, intervalles, contraintes admissibles, gabarits d'inspection, échelles de conséquence, règles de criticité par défaut, délais par priorité, classes d'équipements.

## 5. Exigences non fonctionnelles
- **Authentification et rôles** : Administrateur, Ingénieur intégrité, Inspecteur, Lecteur. Droits par installation.
- **Piste d'audit** : qui a modifié quoi et quand, sur toutes les données d'intégrité (changements de criticité, de matrice ou de résultats d'inspection en particulier).
- **Exports** : CSV et Excel pour toutes les listes, plus un export au format de chargement de la GMAO (SAP PM ou Maximo, format à définir).
- **Tableaux de bord** : connexion possible à Power BI (API ou vues SQL).
- **Sécurité** : HTTPS, mots de passe hachés, protection contre les failles OWASP courantes, aucun secret dans le code.
- **Langue** : interface en français et en anglais (i18n).
- **Unités** : métriques (mm, barg, °C).

## 6. Pile technique suggérée (à discuter)
- Front-end : Vuejs + les elements necessaires (s'inspirer de l'architechture de JRAPay).
- Back-end : Nodejs + express et tout les necessaires . Le module de calcul doit être isolé, pur et testé.
- Base de données : MySQL avec phpmyadmin.
- Déploiement : Docker Compose (application, base de données, stockage de fichiers compatible S3).
- Tests : tests unitaires des calculs (obligatoires), tests d'API, quelques tests de bout en bout.

Si tu recommandes une autre pile, explique pourquoi.

## 7. Données de démonstration
Inclure un jeu de données fictif comme dans le prototype : un FPSO (« FPSO Aurora ») et une WHP (« Wellhead Platform Alpha »), une quarantaine d'actifs avec historiques d'inspection et une dizaine d'anomalies. Prévoir aussi un **import Excel** pour charger nos vraies listes d'actifs.

## 8. Étapes proposées
1. **Socle** : modèle de données, authentification, registre des actifs, hiérarchie, import et export.
2. **Calculs** : module t_min, vitesses de corrosion, RL, PoF/CoF, intervalles, avec tests unitaires et exemples chiffrés.
3. **Inspections et anomalies** : gabarits, saisie, planning, anomalies, réparations temporaires.
4. **Criticité, RBI et tableau de bord.**
5. **Stratégie de maintenance, pièces de rechange, documents.**
6. **Configuration, piste d'audit, exports GMAO, i18n, durcissement et déploiement.**

À la fin de chaque étape : application qui démarre, tests qui passent, et une courte note de ce qui a été fait.

## 9. Critères d'acceptation (exemples)
- Une mesure UT sous t_min déclenche la proposition d'une anomalie P1 et le risque de l'actif est recalculé.
- Changer une case de la matrice de risque met à jour immédiatement les risques et les dates d'échéance.
- Une anomalie ne peut pas être clôturée si une action est ouverte.
- Chaque calcul RBI est reproductible et expliqué ligne par ligne dans la fiche actif.
- Toute modification de donnée d'intégrité apparaît dans la piste d'audit.

## 10. Avertissements à respecter
- Logiciel lié à la sécurité : **tous les calculs devront être validés par des ingénieurs intégrité qualifiés** avant toute utilisation opérationnelle. Afficher un avertissement tant que la validation n'est pas faite.
- Ne copier aucun élément propriétaire (Petrofac, API 581, etc.).
- Me poser des questions plutôt que d'inventer quand une règle métier n'est pas claire.
