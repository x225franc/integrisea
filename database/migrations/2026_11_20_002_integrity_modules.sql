-- Étapes 3 à 5 : configuration, gabarits, inspections, anomalies, risque, maintenance, pièces, documents.

-- Configuration du moteur (une ligne par clé : matrix, intervals, allowableStress, …). Fusionnée sur les valeurs par défaut.
CREATE TABLE config_settings (
  setting_key VARCHAR(60) PRIMARY KEY,
  value_json JSON NOT NULL,
  updated_by INT UNSIGNED NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cfg_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE inspection_templates (
  id VARCHAR(20) PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  classes JSON NOT NULL,
  fields JSON NOT NULL,
  rules JSON NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fichiers stockés (disque local ou S3). Le contenu n'est jamais en base.
CREATE TABLE files (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  storage_key VARCHAR(255) NOT NULL UNIQUE,
  original_name VARCHAR(255) NOT NULL,
  mime VARCHAR(120) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  uploaded_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_files_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE inspections (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(30) NOT NULL UNIQUE,
  asset_id INT UNSIGNED NOT NULL,
  template_id VARCHAR(20) NOT NULL,
  performed_on DATE NOT NULL,
  inspector VARCHAR(120) NULL,
  data JSON NOT NULL,
  readings JSON NULL,
  min_thickness DECIMAL(8,2) NULL,
  grade TINYINT UNSIGNED NULL,
  grade_reasons JSON NULL,
  notes TEXT NULL,
  report_file_id INT UNSIGNED NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_insp_asset_date (asset_id, performed_on),
  CONSTRAINT fk_insp_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_insp_tpl FOREIGN KEY (template_id) REFERENCES inspection_templates(id) ON DELETE RESTRICT,
  CONSTRAINT fk_insp_report FOREIGN KEY (report_file_id) REFERENCES files(id) ON DELETE SET NULL,
  CONSTRAINT fk_insp_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE inspection_attachments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  inspection_id INT UNSIGNED NOT NULL,
  file_id INT UNSIGNED NOT NULL,
  CONSTRAINT fk_ia_insp FOREIGN KEY (inspection_id) REFERENCES inspections(id) ON DELETE CASCADE,
  CONSTRAINT fk_ia_file FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE anomalies (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(30) NOT NULL UNIQUE,
  asset_id INT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  priority ENUM('P1','P2','P3','P4') NOT NULL,
  status ENUM('Open','InProgress','Closed') NOT NULL DEFAULT 'Open',
  owner VARCHAR(120) NULL,
  raised_on DATE NOT NULL,
  due_date DATE NOT NULL,
  closed_on DATE NULL,
  source_inspection_id INT UNSIGNED NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_an_asset (asset_id),
  KEY idx_an_status (status, priority),
  CONSTRAINT fk_an_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_an_insp FOREIGN KEY (source_inspection_id) REFERENCES inspections(id) ON DELETE SET NULL,
  CONSTRAINT fk_an_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE anomaly_actions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  anomaly_id INT UNSIGNED NOT NULL,
  action_text VARCHAR(500) NOT NULL,
  owner VARCHAR(120) NULL,
  due_date DATE NULL,
  done TINYINT(1) NOT NULL DEFAULT 0,
  done_on DATE NULL,
  CONSTRAINT fk_aa_anomaly FOREIGN KEY (anomaly_id) REFERENCES anomalies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE temporary_repairs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  anomaly_id INT UNSIGNED NOT NULL,
  repair_type VARCHAR(120) NOT NULL,
  installed_on DATE NULL,
  expires_on DATE NOT NULL,
  notes VARCHAR(500) NULL,
  removed_on DATE NULL,
  CONSTRAINT fk_tr_anomaly FOREIGN KEY (anomaly_id) REFERENCES anomalies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Résultat du moteur par actif (cache). Recalculé à chaque inspection, anomalie, modification d'actif ou de configuration,
-- et chaque jour (les échéances dépendent de la date). Sert aux listes, au tableau de bord et à Power BI.
CREATE TABLE asset_risk (
  asset_id INT UNSIGNED PRIMARY KEY,
  tracking ENUM('thickness','condition') NOT NULL,
  pof TINYINT UNSIGNED NOT NULL,
  pof_base TINYINT UNSIGNED NOT NULL,
  cof TINYINT UNSIGNED NOT NULL,
  risk ENUM('L','M','MH','H') NOT NULL,
  criticality ENUM('A','B','C') NOT NULL,
  sce TINYINT(1) NOT NULL DEFAULT 0,
  tmin DECIMAL(8,2) NULL,
  t_last DECIMAL(8,2) NULL,
  corrosion_rate DECIMAL(8,4) NULL,
  remaining_life DECIMAL(8,2) NULL,
  interval_months INT NOT NULL,
  base_date DATE NULL,
  due_date DATE NULL,
  days_to_due INT NULL,
  schedule_status ENUM('overdue','due_soon','planned','unknown') NOT NULL,
  calculable TINYINT(1) NOT NULL DEFAULT 1,
  end_of_life TINYINT(1) NOT NULL DEFAULT 0,
  result JSON NOT NULL,
  computed_for DATE NOT NULL,
  computed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_risk_cell (pof, cof),
  KEY idx_risk_due (due_date),
  CONSTRAINT fk_risk_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE fmea_library (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  class_code VARCHAR(20) NOT NULL,
  failure_mode VARCHAR(200) NOT NULL,
  mechanism VARCHAR(200) NULL,
  effect VARCHAR(255) NULL,
  task VARCHAR(255) NOT NULL,
  method VARCHAR(120) NULL,
  interval_months INT NULL,            -- NULL = intervalle fixé par le RBI
  discipline VARCHAR(80) NULL,
  CONSTRAINT fk_fmea_class FOREIGN KEY (class_code) REFERENCES asset_classes(code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE spare_parts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  description VARCHAR(255) NOT NULL,
  category VARCHAR(80) NULL,
  criticality ENUM('High','Medium','Low') NOT NULL DEFAULT 'Medium',
  stock INT NOT NULL DEFAULT 0,
  min_stock INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bom (
  asset_id INT UNSIGNED NOT NULL,
  part_id INT UNSIGNED NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  PRIMARY KEY (asset_id, part_id),
  CONSTRAINT fk_bom_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  CONSTRAINT fk_bom_part FOREIGN KEY (part_id) REFERENCES spare_parts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE documents (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  doc_number VARCHAR(80) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  doc_type VARCHAR(40) NOT NULL,
  facility_id INT UNSIGNED NULL,
  current_revision VARCHAR(20) NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_doc_type (doc_type),
  CONSTRAINT fk_doc_fac FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE SET NULL,
  CONSTRAINT fk_doc_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE document_versions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_id INT UNSIGNED NOT NULL,
  revision VARCHAR(20) NOT NULL,
  file_id INT UNSIGNED NULL,
  comment VARCHAR(255) NULL,
  uploaded_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_dv_doc FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_dv_file FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL,
  CONSTRAINT fk_dv_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE document_assets (
  document_id INT UNSIGNED NOT NULL,
  asset_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (document_id, asset_id),
  CONSTRAINT fk_da_doc FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_da_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Vues SQL pour Power BI (lecture seule). Pas de colonne sensible (aucun mot de passe, aucun JSON interne).
CREATE VIEW v_bi_assets AS
  SELECT a.id AS asset_id, a.tag, a.description, f.code AS facility_code, f.name AS facility_name, s.code AS system_code, s.name AS system_name,
         a.class_code, a.fluid, a.material, a.design_pressure_barg, a.design_temp_c, a.od_mm, a.nominal_thickness_mm, a.install_year,
         r.pof, r.cof, r.risk, r.criticality, r.sce, r.tmin, r.t_last, r.corrosion_rate, r.remaining_life, r.interval_months,
         r.due_date, r.days_to_due, r.schedule_status, a.archived_at
  FROM assets a JOIN systems s ON s.id = a.system_id JOIN facilities f ON f.id = s.facility_id LEFT JOIN asset_risk r ON r.asset_id = a.id;

CREATE VIEW v_bi_inspections AS
  SELECT i.id AS inspection_id, i.reference, a.tag, i.template_id, i.performed_on, i.inspector, i.grade, i.min_thickness
  FROM inspections i JOIN assets a ON a.id = i.asset_id;

CREATE VIEW v_bi_anomalies AS
  SELECT n.id AS anomaly_id, n.reference, a.tag, n.title, n.priority, n.status, n.raised_on, n.due_date, n.closed_on,
         (n.status <> 'Closed' AND n.due_date < CURRENT_DATE) AS is_overdue
  FROM anomalies n JOIN assets a ON a.id = n.asset_id;
