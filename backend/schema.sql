-- Run this once as a MySQL administrator to create the application database.
CREATE DATABASE IF NOT EXISTS file_organizer
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE file_organizer;

CREATE TABLE IF NOT EXISTS users (
  id INT NOT NULL AUTO_INCREMENT,
  username VARCHAR(40) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  checkboss BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  KEY ix_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS organize_jobs (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  job_type VARCHAR(50) NOT NULL DEFAULT 'upload',
  source_path VARCHAR(500) NULL,
  file_count INT NOT NULL DEFAULT 0,
  folder_count INT NOT NULL DEFAULT 0,
  summary_json TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY ix_organize_jobs_user_id (user_id),
  CONSTRAINT fk_organize_jobs_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
