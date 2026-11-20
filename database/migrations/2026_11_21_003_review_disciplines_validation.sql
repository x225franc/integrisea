-- Revue des hypothèses (réponse du client) : disciplines, validation des paramètres provisoires, nouvelles formes de configuration.

-- 1. Discipline des actifs : valeur par défaut portée par la classe, modifiable sur chaque actif.
ALTER TABLE asset_classes ADD COLUMN default_discipline VARCHAR(40) NULL AFTER tracking;
ALTER TABLE assets ADD COLUMN discipline VARCHAR(40) NULL AFTER class_code, ADD KEY idx_assets_discipline (discipline);

UPDATE asset_classes SET default_discipline = CASE code
  WHEN 'STR' THEN 'Structural' WHEN 'RISER' THEN 'Pipelines' ELSE 'Pressure Systems' END;
UPDATE assets a JOIN asset_classes c ON c.code = a.class_code SET a.discipline = c.default_discipline WHERE a.discipline IS NULL;

-- Bibliothèque AMDE : Integrity / Mechanical / Instrument -> Pressure Systems ; Structural -> Structural ; Subsea -> Pipelines ;
-- Electrical -> Pressure Systems (provisoire, à confirmer).
UPDATE fmea_library SET discipline = CASE discipline
  WHEN 'Structural' THEN 'Structural' WHEN 'Subsea' THEN 'Pipelines'
  WHEN 'Integrity' THEN 'Pressure Systems' WHEN 'Mechanical' THEN 'Pressure Systems'
  WHEN 'Instrument' THEN 'Pressure Systems' WHEN 'Electrical' THEN 'Pressure Systems'
  ELSE discipline END;

-- 2. Paramètres provisoires : un paramètre reste « provisoire » tant qu'un administrateur ne l'a pas validé.
ALTER TABLE config_settings ADD COLUMN validated_at DATETIME NULL, ADD COLUMN validated_by INT UNSIGNED NULL;
ALTER TABLE inspection_templates ADD COLUMN validated_at DATETIME NULL, ADD COLUMN validated_by INT UNSIGNED NULL;

-- 3. Anciennes formes de configuration supprimées (remplacées par des clés plus riches ; les valeurs précédentes restent dans la piste d'audit) :
--    contraintes admissibles par matériau seul -> matériau x température ; planchers structurels à deux valeurs -> table par diamètre ;
--    PoF par défaut unique et plancher de vitesse unique -> defaultPof et corrosionFloors.
DELETE FROM config_settings WHERE setting_key = 'allowableStress' AND CAST(value_json AS CHAR) NOT LIKE '%tempC%';
DELETE FROM config_settings WHERE setting_key = 'structuralMin' AND CAST(value_json AS CHAR) LIKE '%pipeSmall%';
DELETE FROM config_settings WHERE setting_key IN ('defaultPofNoData', 'minCorrosionRate');

-- 4. Gabarit Ex : gravité par point de contrôle (remplace l'échelle « nombre de non-conformités ») si l'ancienne règle est encore en place.
UPDATE inspection_templates SET fields = '[{"k":"c1","l":"Marking and certificate match the area classification","t":"pf","sev":"critical"},{"k":"c2","l":"Enclosure and glass undamaged","t":"pf"},{"k":"c3","l":"Flamepath gaps and fasteners satisfactory","t":"pf","sev":"critical"},{"k":"c4","l":"Cable glands secure and correct type","t":"pf","sev":"critical"},{"k":"c5","l":"Earthing and bonding intact","t":"pf","sev":"critical"},{"k":"c6","l":"No unauthorised modifications","t":"pf"},{"k":"notes","l":"Findings / notes","t":"textarea"}]', `rules` = '[{"type":"severityFail","critical":3,"normal":2,"countAtLeast":3,"countGrade":4}]'
 WHERE id = 'EXD' AND CAST(`rules` AS CHAR) LIKE '%failCountMap%';
