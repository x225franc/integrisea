-- Étape 1 : socle (utilisateurs, droits par installation, hiérarchie, registre des actifs, piste d'audit)

CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  locale ENUM('fr','en') NOT NULL DEFAULT 'fr',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  token_version INT UNSIGNED NOT NULL DEFAULT 0,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE facilities (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  type VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Droit d'un utilisateur sur une installation (l'administrateur global voit tout).
CREATE TABLE user_facility_roles (
  user_id INT UNSIGNED NOT NULL,
  facility_id INT UNSIGNED NOT NULL,
  role ENUM('reader','inspector','engineer') NOT NULL,
  PRIMARY KEY (user_id, facility_id),
  CONSTRAINT fk_ufr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ufr_facility FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE systems (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  facility_id INT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sys_facility FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Classes d'équipements configurables. `tracking` indique le mode de suivi (utilisé par le moteur de calcul à l'étape 2).
CREATE TABLE asset_classes (
  code VARCHAR(20) PRIMARY KEY,
  name_en VARCHAR(100) NOT NULL,
  name_fr VARCHAR(100) NOT NULL,
  tracking ENUM('thickness','condition') NOT NULL DEFAULT 'condition',
  cfihos_code VARCHAR(40) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Attributs supplémentaires configurables (globaux ou propres à une classe), avec référence CFIHOS.
CREATE TABLE asset_attribute_defs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  class_code VARCHAR(20) NULL,
  attr_key VARCHAR(50) NOT NULL,
  label_en VARCHAR(100) NOT NULL,
  label_fr VARCHAR(100) NOT NULL,
  data_type ENUM('text','number','date','boolean') NOT NULL DEFAULT 'text',
  cfihos_ref VARCHAR(60) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_attr (class_code, attr_key),
  CONSTRAINT fk_attr_class FOREIGN KEY (class_code) REFERENCES asset_classes(code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE assets (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tag VARCHAR(60) NOT NULL UNIQUE,
  system_id INT UNSIGNED NOT NULL,
  class_code VARCHAR(20) NOT NULL,
  description VARCHAR(255) NOT NULL,
  fluid VARCHAR(80) NULL,
  material VARCHAR(80) NULL,
  design_pressure_barg DECIMAL(10,2) NULL,
  design_temp_c DECIMAL(7,2) NULL,
  od_mm DECIMAL(10,2) NULL,
  nominal_thickness_mm DECIMAL(8,2) NULL,
  install_year SMALLINT UNSIGNED NULL,
  degradation_mechanisms JSON NULL,
  custom_attributes JSON NULL,
  -- Notes de conséquence 1-5 (S, E, P). NULL = valeur par défaut selon le fluide (étape 4).
  crit_s TINYINT UNSIGNED NULL,
  crit_e TINYINT UNSIGNED NULL,
  crit_p TINYINT UNSIGNED NULL,
  archived_at DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_assets_system (system_id),
  KEY idx_assets_class (class_code),
  KEY idx_assets_archived (archived_at),
  CONSTRAINT fk_assets_system FOREIGN KEY (system_id) REFERENCES systems(id) ON DELETE RESTRICT,
  CONSTRAINT fk_assets_class FOREIGN KEY (class_code) REFERENCES asset_classes(code) ON DELETE RESTRICT,
  CONSTRAINT fk_assets_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Piste d'audit : écrite uniquement par le serveur, jamais modifiée.
CREATE TABLE audit_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  user_id INT UNSIGNED NULL,
  user_email VARCHAR(190) NULL,
  action VARCHAR(40) NOT NULL,
  entity VARCHAR(40) NOT NULL,
  entity_id VARCHAR(60) NULL,
  entity_label VARCHAR(255) NULL,
  facility_id INT UNSIGNED NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  ip VARCHAR(64) NULL,
  KEY idx_audit_time (occurred_at),
  KEY idx_audit_entity (entity, entity_id),
  KEY idx_audit_facility (facility_id),
  KEY idx_audit_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
