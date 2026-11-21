# Réponse à la section 10 de hypotheses-a-valider.md

Points 1, 2, 3, 4, 5 et 9 : acceptés tels quels.

## Point 6 — Gravité des points Ex
- « Modifications non autorisées » → **critique**.
- Séparer « enceinte et verre » en deux points :
  - « corrosion ou dommage superficiel » → non critique ;
  - « fissure, bris ou déformation de l'enceinte ou du verre » → **critique**.

## Point 7 — Sessions
Garder le jeton de rafraîchissement de 8 h glissantes, mais ajouter une **durée de session maximale absolue de 12 h**. Une nouvelle connexion est obligatoire ensuite. Cette durée est configurable.

## Point 8 — Compte verrouillé
Afficher un **message générique partout** : « Identifiants invalides ou compte temporairement verrouillé ». Utiliser le même code de réponse que pour un échec normal, pour ne pas révéler quels comptes existent. Le verrouillage reste visible par l'administrateur et dans la piste d'audit.

## Correction supplémentaire — Priorité d'anomalie suggérée
**Grade 4 → P1** (au lieu de P2). C'est cohérent avec « action immédiate » et avec la PoF de 5.

---

Merci de :
1. mettre à jour les tests ;
2. mettre à jour `hypotheses-a-valider.md` et la note récapitulative ;
3. confirmer que tous les tests du moteur passent.
