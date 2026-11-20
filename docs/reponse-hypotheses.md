# Réponse au document « Hypothèses de calcul et choix métier à faire valider »

> **Contexte : phase de test.** Les choix ci-dessous sont des **valeurs provisoires fondées sur les bonnes pratiques**, pour pouvoir tester l'application. L'arbitrage définitif viendra plus tard. Toutes ces valeurs doivent donc rester **modifiables dans Configuration** et être **signalées comme « provisoires »** (badge ou mention visible) tant qu'un administrateur ne les a pas validées. L'avertissement « non validé pour usage opérationnel » reste affiché.

Merci de :
1. appliquer les changements ci-dessous ;
2. ajouter ou adapter les tests unitaires du moteur de calcul pour chaque changement, avec des exemples chiffrés ;
3. mettre à jour `hypotheses-a-valider.md` : pour chaque ligne, indiquer la décision prise, la marquer « provisoire — à arbitrer », et y lister tout nouveau choix que tu fais ;
4. me poser la question si une consigne est ambiguë, plutôt que de l'interpréter.

---

## 1. Corrections du moteur de calcul (bonnes pratiques)

### 1.1 Vitesse de corrosion et durée de vie résiduelle par CML
- **Abandonner le « CML gouvernant » par inspection.** Comparer le minimum d'une inspection au minimum de la suivante revient à comparer des emplacements différents.
- Calculer, **pour chaque CML** :
  - une vitesse long terme : `(t_référence − t_dernière) / durée` ;
  - une vitesse court terme : entre les deux dernières mesures **de ce CML** ;
  - CR_CML = la plus élevée des deux, avec le plancher du §2.2 ;
  - RL_CML = `(t_dernière − t_min) / CR_CML − années écoulées depuis la mesure`.
- La **RL de l'actif = la plus faible RL_CML**. Le CML qui la donne est le « CML gouvernant », affiché dans la fiche avec son épaisseur et sa vitesse.
- Si un CML n'a qu'une mesure, n'utiliser que la vitesse long terme. Un CML nouveau, sans référence, ne sert qu'à l'inspection suivante.
- **Épaisseur de référence (`t_référence`)** : la première mesure du CML (mesure de référence) si elle existe. Sinon `t_nom`, depuis le 1er juillet de l'année d'installation.
- La courbe d'épaisseur de la fiche doit afficher **une série par CML**, en mettant en évidence le CML gouvernant.

### 1.2 Contraintes admissibles fonction de la température
- La table devient **matériau × température** (S en MPa pour plusieurs températures). On fait une **interpolation linéaire** à la température de calcul de l'actif.
- **Pas d'extrapolation** : au-delà de la plage renseignée, ou si le matériau est absent, l'actif reste « non calculable » (comportement actuel conservé).
- Production : table vide (inchangé). Démonstration : les 4 valeurs fictives sont appliquées à toute la plage −29 °C à 200 °C et clairement étiquetées **FICTIVES**.
- Prévoir l'import de la table depuis Excel/CSV.

### 1.3 Formule des appareils à pression
- Remplacer la formule au rayon intérieur nominal par la **formule au rayon extérieur** (ASME VIII Div. 1, appendice 1-1) : `t = P·Ro / (S·E + 0,4·P)`, avec `Ro = D/2`.
- Elle ne dépend plus de l'épaisseur et reste valable quand la paroi s'amincit.
- Domaine : **viroles cylindriques uniquement**. Les fonds et les éléments coniques sont hors périmètre. Le dire dans le détail du calcul.

### 1.4 Actif jamais inspecté
- PoF par défaut = **4 si CoF ≥ 4**, sinon **3**. Ces deux valeurs sont configurables.
- Le détail du calcul l'indique (« aucune inspection — PoF par défaut conservateur »).

### 1.5 Conséquence inconnue
- Un actif sans note de conséquence et sans fluide connu reçoit **CoF = 5** (au lieu de 3). Il reste signalé « incomplet » sur le tableau de bord et dans la liste RBI.

### 1.6 Correspondance grade → PoF (équipements suivis par leur état)
- Table configurable, valeurs par défaut : **grade 1 → PoF 1, 2 → 2, 3 → 3, 4 → 5**.
- Un grade 4 (« action immédiate ») doit pouvoir atteindre PoF 5 sans modificateur.

### 1.7 Points complémentaires
- **Tolérance de fabrication et surépaisseur de corrosion** : elles ne sont pas intégrées dans t_min. C'est volontaire, à mentionner dans le détail du calcul. Le passage à une mesure de référence (§1.1) réduit l'effet de la tolérance de fabrication.

---

## 2. Paramètres à mettre en place (valeurs provisoires)

### 2.1 Conservés tels quels (provisoires)
- **Matrice 5×5** basée sur la somme PoF + CoF : à garder comme matrice de test, mais affichée comme « matrice provisoire, à remplacer par la matrice société ».
- **Seuils PoF / RL** : ≥ 20 → 1 ; 10–20 → 2 ; 5–10 → 3 ; 2–5 → 4 ; < 2 → 5.
- **Intervalles maximum par risque** : L 96, M 60, MH 36, H 12 mois.
- **Intervalles maximum par classe** : Ex 36, PSV 36, flexibles 12, tubing 24 mois.
- **Plafond « moitié de la RL »** : seulement pour les actifs suivis en épaisseur, calculé à la date de la dernière mesure.
- **Modificateurs** : +1 pour une inspection en retard (appliqué après le calcul de l'intervalle) ; +1 pour une anomalie P1/P2 ouverte (une seule fois) ; PoF plafonné à 5.
- **Épaisseurs structurelles minimales** : 2,0 mm (D ≤ 114,3 mm) et 2,8 mm au-delà pour les tuyauteries ; 2,5 mm pour les appareils. Elles sont provisoires et seront remplacées par la table société. Prévoir une table par plage de diamètre plutôt que deux valeurs fixes.
- **Notes de conséquence par défaut selon le fluide** et échelles descriptives : provisoires.

### 2.2 Modifiés
- **Plancher de vitesse de corrosion par famille de matériau**, configurable :
  - aciers carbone et faiblement alliés : **0,05 mm/an** ;
  - alliages résistants à la corrosion (duplex, inox 316L, CuNi…) : **0,01 mm/an**.

  Il s'applique à chaque CR_CML. Si la famille du matériau est inconnue, on prend la valeur acier carbone (conservateur).

---

## 3. Disciplines

Nos disciplines sont **Pressure Systems**, **Structural** et **Pipelines**.

- Ajouter un champ **discipline** sur l'actif. Sa valeur par défaut dépend de la classe et reste modifiable :

| Classe | Discipline par défaut |
|---|---|
| PV, HX, PSV, PIPE (tuyauteries de procédé topsides), SBT, HOSE | Pressure Systems |
| STR (jacket, nœuds, ponts, helideck, coque, boat landing, conductors) | Structural |
| RISER, et toute ligne d'export ou sous-marine | Pipelines |
| EX | Pressure Systems — **provisoire**, discipline à confirmer |

- Remplacer les valeurs de discipline de la bibliothèque AMDE : Integrity / Mechanical / Instrument → **Pressure Systems** ; Structural → **Structural** ; Subsea → **Pipelines** ; Electrical → **Pressure Systems (provisoire)**.
- Ajouter un **filtre par discipline** sur le registre des actifs, le planning d'inspection, les anomalies et la liste RBI.
- La liste des disciplines est configurable.

### Règles de grade des gabarits (provisoires)
- **Ex** : remplacer l'échelle « nombre de non-conformités » par une **gravité par point de contrôle**.
  - Un point **critique** non conforme donne un grade **≥ 3**. Points critiques : certificat ou marquage incompatible avec la zone, chemin de flamme ou fixations, presse-étoupes, mise à la terre et liaisons équipotentielles.
  - Un autre point non conforme donne un grade ≥ 2.
  - Trois points non conformes ou plus donnent un grade 4.
  - La gravité de chaque point est configurable dans le gabarit.
- **Structures** : seuil de revêtement dégradé > 30 % → grade ≥ 3 (conservé) ; fissure → grade 4.
- **PSV** : écart > 3 % → 3, écart > 10 % → 4, étanchéité du siège non conforme → ≥ 3 (conservé).
- **Tubing** : raccords desserrés > 3 → ≥ 3, > 0 → ≥ 2 (conservé). **Flexibles et annulaire** : un point non conforme → ≥ 3 (conservé).

---

## 4. Procédure d'anomalies (validée selon les recommandations)

**Priorité suggérée** : c'est une proposition, jamais une création automatique. La plus urgente l'emporte.

| Constat | Priorité suggérée |
|---|---|
| Épaisseur mesurée < t_min | **P1** |
| RL < 2 ans | **P1** *(modifié, était P2)* |
| RL < 5 ans | P3 |
| Grade 4 | P2 |
| Grade 3 | P3 |

- **Délais cibles** : P1 7 j, P2 30 j, P3 90 j, P4 365 j (inchangés).
- **Alerte avant l'expiration d'une réparation temporaire** : **90 jours** (au lieu de 30). C'est le temps d'étudier et de planifier la réparation définitive.

---

## 5. Sécurité et informatique

- **Jeton de session** : quitter le stockage local du navigateur. Utiliser un **cookie httpOnly**, `Secure`, `SameSite=Strict`, avec une protection CSRF sur les requêtes qui modifient des données.
- **Jetons de rafraîchissement** : jeton d'accès de courte durée (15 min) et jeton de rafraîchissement avec rotation, révocable à la déconnexion.
- **Verrouillage de compte** : après 5 échecs de connexion, blocage de 15 minutes pour cet utilisateur. On garde aussi la limitation par adresse IP. Ces actions sont enregistrées dans la piste d'audit.
- **SSO (OIDC / Azure AD) et double authentification** : à ne pas implémenter maintenant, mais l'architecture d'authentification doit permettre de les ajouter sans refonte. À noter dans le document d'hypothèses.
- **Export Maximo** : garder le mapping isolé comme aujourd'hui, avec la mention « à confirmer avec l'équipe Maximo ». Pas d'autre changement.

---

## 6. Points acceptés sans changement

- Seuls les actifs de niveau **H** comptent comme « à risque élevé » sur le tableau de bord.
- Échéance proche = 90 jours. Fin de vie = RL < 10 ans ou anomalie P1/P2 ouverte.
- Épaisseur < t_min → RL = 0 (valeur brute conservée dans le détail), PoF 5, intervalle 0, anomalie P1 proposée.
- Données de démonstration chargées hors production uniquement.
- Les libellés des gabarits restent des données, sans traduction automatique.
- Hors périmètre, comme prévu : moteur API 580/581 quantitatif, mode hors ligne, gammes et tournées, prévision des charges.

---

## 7. Livrables attendus

1. Le code modifié, avec les migrations de base de données (table des contraintes matériau × température, champ discipline, table grade → PoF, planchers de corrosion, sécurité).
2. Des tests unitaires du moteur couvrant chaque point des §1 et §2.2, avec au moins un exemple chiffré documenté par règle (RL par CML, interpolation de S, formule au rayon extérieur, PoF par défaut, CoF inconnue, grade 4 → PoF 5, plancher de vitesse).
3. Un `hypotheses-a-valider.md` mis à jour.
4. Une courte note récapitulative des changements et de tout point resté en suspens.
