-- Base roles
INSERT INTO iam.role(code, name)
VALUES
  ('admin', 'Amministratore'),
  ('medico', 'Medico'),
  ('infermiere', 'Infermiere')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

-- Base permissions
INSERT INTO iam.permission(code, description)
VALUES
  ('ambulatori.read', 'Visualizzazione ambulatori'),
  ('ambulatori.write', 'Modifica ambulatori e impostazioni'),
  ('patients.read', 'Visualizzazione pazienti'),
  ('patients.write', 'Creazione e modifica pazienti'),
  ('encounters.read', 'Visualizzazione visite'),
  ('encounters.write', 'Creazione e revisione visite'),
  ('appointments.read', 'Visualizzazione agenda'),
  ('appointments.write', 'Gestione appuntamenti'),
  ('reports.read', 'Visualizzazione metadati referti'),
  ('reports.write', 'Registrazione metadati referti'),
  ('users.manage', 'Gestione utenti e credenziali'),
  ('audit.read', 'Consultazione audit')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

-- Role -> permission map
INSERT INTO iam.role_permission(role_id, permission_id)
SELECT r.id, p.id
FROM iam.role r
JOIN iam.permission p ON p.code IN (
  'ambulatori.read',
  'ambulatori.write',
  'patients.read',
  'patients.write',
  'encounters.read',
  'encounters.write',
  'appointments.read',
  'appointments.write',
  'reports.read',
  'reports.write',
  'users.manage',
  'audit.read'
)
WHERE r.code = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permission(role_id, permission_id)
SELECT r.id, p.id
FROM iam.role r
JOIN iam.permission p ON p.code IN (
  'ambulatori.read',
  'patients.read',
  'patients.write',
  'encounters.read',
  'encounters.write',
  'appointments.read',
  'appointments.write',
  'reports.read',
  'reports.write'
)
WHERE r.code = 'medico'
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permission(role_id, permission_id)
SELECT r.id, p.id
FROM iam.role r
JOIN iam.permission p ON p.code IN (
  'ambulatori.read',
  'patients.read',
  'encounters.read',
  'appointments.read',
  'reports.read'
)
WHERE r.code = 'infermiere'
ON CONFLICT DO NOTHING;

-- Demo ambulatori for first boot
INSERT INTO org.ambulatorio(code, name, is_active)
VALUES
  ('DISLIP', 'Ambulatorio Cardiologico delle Dislipidemie', TRUE),
  ('ORTO', 'Ortopedia', TRUE),
  ('DHR', 'Day Hospital Riabilitativa', TRUE)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  is_active = EXCLUDED.is_active;

INSERT INTO org.ambulatorio_settings(ambulatorio_id, min_visit_minutes, standard_visit_minutes, timezone)
SELECT a.id, 10, 15, 'Europe/Rome'
FROM org.ambulatorio a
ON CONFLICT (ambulatorio_id) DO NOTHING;

INSERT INTO org.ambulatorio_theme(ambulatorio_id, logo_path, color_primary, color_secondary, color_accent)
SELECT id,
  CASE code
    WHEN 'DISLIP' THEN '/ambulatori/icon_dislip.png'
    WHEN 'ORTO' THEN '/ambulatori/ortopedia.png'
    WHEN 'DHR' THEN '/ambulatori/icon_dhr.png'
    ELSE NULL
  END,
  CASE code
    WHEN 'DISLIP' THEN '#06b6d4'
    WHEN 'ORTO' THEN '#059669'
    WHEN 'DHR' THEN '#03a19e'
    ELSE '#1e3a8a'
  END,
  CASE code
    WHEN 'DISLIP' THEN '#0891b2'
    WHEN 'ORTO' THEN '#10b981'
    WHEN 'DHR' THEN '#10ccb4'
    ELSE '#3b82f6'
  END,
  CASE code
    WHEN 'DISLIP' THEN '#22d3ee'
    WHEN 'ORTO' THEN '#6ee7b7'
    WHEN 'DHR' THEN '#31e0c6'
    ELSE '#22d3ee'
  END
FROM org.ambulatorio
ON CONFLICT (ambulatorio_id) DO NOTHING;

INSERT INTO org.ambulatorio_operating_window(ambulatorio_id, weekday, start_time, end_time, max_patients_per_day)
SELECT a.id, v.weekday, v.start_time, v.end_time, v.max_patients_per_day
FROM org.ambulatorio a
CROSS JOIN (
  VALUES
    (1, '15:00'::time, '18:00'::time, 15),
    (4, '08:30'::time, '14:00'::time, 25)
) AS v(weekday, start_time, end_time, max_patients_per_day)
ON CONFLICT ON CONSTRAINT ux_window DO NOTHING;

-- Demo admin user (password: admin123, bcrypt legacy hash supported by backend)
INSERT INTO iam.app_user(username, first_name, last_name, status)
VALUES ('admin', 'Admin', 'GMD', 'active')
ON CONFLICT (username) DO UPDATE SET
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  status = EXCLUDED.status;

INSERT INTO iam.user_credential(user_id, password_hash, password_algo, must_rotate)
SELECT u.id,
       '$2b$10$BpnBxVIQpbTUhRhgNpsSeeNzDbzUzkC0wJTnJLPaIQehJcGWuCXye',
       'bcrypt',
       TRUE
FROM iam.app_user u
WHERE u.username = 'admin'
ON CONFLICT (user_id) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  password_algo = EXCLUDED.password_algo,
  must_rotate = EXCLUDED.must_rotate,
  password_changed_at = now();

INSERT INTO iam.user_role(user_id, role_id, scope_type, scope_id)
SELECT u.id, r.id, 'global', NULL
FROM iam.app_user u
JOIN iam.role r ON r.code = 'admin'
WHERE u.username = 'admin'
AND NOT EXISTS (
  SELECT 1
  FROM iam.user_role ur
  WHERE ur.user_id = u.id
    AND ur.role_id = r.id
    AND ur.scope_type = 'global'
    AND ur.scope_id IS NULL
);
