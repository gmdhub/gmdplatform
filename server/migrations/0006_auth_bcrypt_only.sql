ALTER TABLE iam.user_credential
  ALTER COLUMN password_algo SET DEFAULT 'bcrypt';

UPDATE iam.user_credential
SET password_algo = 'bcrypt'
WHERE password_hash LIKE '$2a$%'
   OR password_hash LIKE '$2b$%'
   OR password_hash LIKE '$2y$%';
