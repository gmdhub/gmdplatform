INSERT INTO org.ambulatorio_theme(ambulatorio_id, logo_path, color_primary, color_secondary, color_accent)
SELECT a.id, '/ambulatori/icon_sca.png', '#dc2626', '#ef4444', '#fca5a5'
FROM org.ambulatorio a
WHERE a.code = 'SCA'
ON CONFLICT (ambulatorio_id) DO UPDATE SET
  logo_path = EXCLUDED.logo_path,
  color_primary = EXCLUDED.color_primary,
  color_secondary = EXCLUDED.color_secondary,
  color_accent = EXCLUDED.color_accent;
