-- Sécurité de l'authentification : verrouillage de compte et jetons de rafraîchissement avec rotation.

-- Verrouillage : 5 échecs consécutifs bloquent le compte 15 minutes (compteur et échéance portés par l'utilisateur).
ALTER TABLE users
  ADD COLUMN failed_logins TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN locked_until DATETIME NULL;

-- Jetons de rafraîchissement : seul l'empreinte SHA-256 est stockée. Chaque jeton ne sert qu'une fois (rotation) ;
-- tous les jetons issus d'une même connexion partagent un family_id, révoqué en bloc à la déconnexion ou si un jeton déjà utilisé est rejoué.
CREATE TABLE refresh_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  family_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  token_version INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  replaced_by BIGINT UNSIGNED NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  KEY idx_rt_user (user_id),
  KEY idx_rt_family (family_id),
  KEY idx_rt_expires (expires_at),
  CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
