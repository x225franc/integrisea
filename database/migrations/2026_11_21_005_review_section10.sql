-- Réponse à la section 10 : session maximale absolue, gravité des points Ex, grade 4 -> P1.

-- 1. Durée de session maximale absolue : la date de début de la session est conservée à chaque rotation du jeton de rafraîchissement.
ALTER TABLE refresh_tokens ADD COLUMN session_started_at DATETIME NULL;
UPDATE refresh_tokens SET session_started_at = created_at;

-- 2. Gabarit Ex : « enceinte et verre » séparé en deux points ; « modifications non autorisées » devient critique.
--    Le gabarit repasse en « provisoire » (validation retirée). Uniquement si le gabarit est encore dans l'état de la migration 003.
UPDATE inspection_templates SET
  fields = '[{"k":"c1","l":"Marking and certificate match the area classification","t":"pf","sev":"critical"},{"k":"c2","l":"Enclosure or glass: no corrosion or superficial damage","t":"pf"},{"k":"c2b","l":"Enclosure or glass: no crack, breakage or deformation","t":"pf","sev":"critical"},{"k":"c3","l":"Flamepath gaps and fasteners satisfactory","t":"pf","sev":"critical"},{"k":"c4","l":"Cable glands secure and correct type","t":"pf","sev":"critical"},{"k":"c5","l":"Earthing and bonding intact","t":"pf","sev":"critical"},{"k":"c6","l":"No unauthorised modifications","t":"pf","sev":"critical"},{"k":"notes","l":"Findings / notes","t":"textarea"}]',
  validated_at = NULL, validated_by = NULL
WHERE id = 'EXD' AND CAST(`rules` AS CHAR) LIKE '%severityFail%' AND CAST(fields AS CHAR) NOT LIKE '%"c2b"%';

-- 3. Anomalie suggérée : grade 4 -> P1 (si la valeur enregistrée est encore l'ancienne P2 ; une valeur choisie par un administrateur n'est pas touchée).
UPDATE config_settings SET value_json = JSON_SET(value_json, '$.grade4', 'P1'), validated_at = NULL, validated_by = NULL
WHERE setting_key = 'anomalySuggestion' AND JSON_UNQUOTE(JSON_EXTRACT(value_json, '$.grade4')) = 'P2';
