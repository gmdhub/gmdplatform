INSERT INTO org.ambulatorio(code, name, is_active)
VALUES ('SCA', 'Ambulatorio SCA', TRUE)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  is_active = EXCLUDED.is_active;

INSERT INTO org.ambulatorio_settings(ambulatorio_id, min_visit_minutes, standard_visit_minutes, timezone)
SELECT a.id, 10, 15, 'Europe/Rome'
FROM org.ambulatorio a
WHERE a.code = 'SCA'
ON CONFLICT (ambulatorio_id) DO NOTHING;

INSERT INTO org.ambulatorio_theme(ambulatorio_id, logo_path, color_primary, color_secondary, color_accent)
SELECT a.id, NULL, '#dc2626', '#ef4444', '#fca5a5'
FROM org.ambulatorio a
WHERE a.code = 'SCA'
ON CONFLICT (ambulatorio_id) DO UPDATE SET
  logo_path = EXCLUDED.logo_path,
  color_primary = EXCLUDED.color_primary,
  color_secondary = EXCLUDED.color_secondary,
  color_accent = EXCLUDED.color_accent;

INSERT INTO org.ambulatorio_operating_window(ambulatorio_id, weekday, start_time, end_time, max_patients_per_day)
SELECT a.id, v.weekday, v.start_time, v.end_time, v.max_patients_per_day
FROM org.ambulatorio a
CROSS JOIN (
  VALUES
    (1, '15:00'::time, '18:00'::time, 15),
    (4, '08:30'::time, '14:00'::time, 25)
) AS v(weekday, start_time, end_time, max_patients_per_day)
WHERE a.code = 'SCA'
ON CONFLICT ON CONSTRAINT ux_window DO NOTHING;
