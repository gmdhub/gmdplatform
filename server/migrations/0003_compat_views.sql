CREATE SCHEMA IF NOT EXISTS compat;

CREATE OR REPLACE VIEW compat.users AS
SELECT
  u.legacy_id::BIGINT AS id,
  u.username::TEXT AS username,
  c.password_hash,
  COALESCE(
    CASE
      WHEN bool_or(r.code = 'admin') THEN 'admin'
      WHEN bool_or(r.code = 'medico') THEN 'medico'
      ELSE 'infermiere'
    END,
    'infermiere'
  ) AS role,
  u.first_name AS nome,
  u.last_name AS cognome,
  u.created_at,
  u.updated_at,
  u.id AS internal_id
FROM iam.app_user u
LEFT JOIN iam.user_credential c ON c.user_id = u.id
LEFT JOIN iam.user_role ur ON ur.user_id = u.id
LEFT JOIN iam.role r ON r.id = ur.role_id
GROUP BY u.id, u.legacy_id, u.username, c.password_hash, u.first_name, u.last_name, u.created_at, u.updated_at;

CREATE OR REPLACE VIEW compat.ambulatori AS
SELECT
  a.id,
  a.name AS nome,
  t.logo_path,
  t.color_primary,
  t.color_secondary,
  t.color_accent,
  NULL::TEXT AS indirizzo,
  NULL::TEXT AS telefono,
  NULL::TEXT AS email,
  s.min_visit_minutes AS durata_minima_visita_minuti,
  s.standard_visit_minutes AS durata_standard_visita_minuti,
  a.created_at,
  a.updated_at
FROM org.ambulatorio a
LEFT JOIN org.ambulatorio_theme t ON t.ambulatorio_id = a.id
LEFT JOIN org.ambulatorio_settings s ON s.ambulatorio_id = a.id;

CREATE OR REPLACE VIEW compat.ambulatorio_orari AS
SELECT
  ow.id,
  ow.ambulatorio_id,
  ow.weekday,
  to_char(ow.start_time, 'HH24:MI') AS ora_inizio,
  to_char(ow.end_time, 'HH24:MI') AS ora_fine,
  ow.max_patients_per_day AS max_pazienti_giorno,
  ow.created_at,
  ow.updated_at
FROM org.ambulatorio_operating_window ow;

CREATE OR REPLACE VIEW compat.pazienti AS
SELECT
  p.legacy_id::BIGINT AS id,
  p.ambulatorio_id,
  p.first_name AS nome,
  p.last_name AS cognome,
  p.birth_date::TEXT AS data_nascita,
  p.birth_place AS luogo_nascita,
  COALESCE(p.tax_code::TEXT, p.temporary_code, '') AS codice_fiscale,
  p.sex AS sesso,
  COALESCE(p.exemptions, '') AS esenzioni,
  COALESCE(p.address, '') AS indirizzo,
  COALESCE(p.city, '') AS citta,
  COALESCE(p.cap, '') AS cap,
  COALESCE(p.province, '') AS provincia,
  COALESCE(p.phone, '') AS telefono,
  COALESCE(p.email, '') AS email,
  p.created_at,
  p.updated_at,
  p.id AS internal_id
FROM patient.patient p
WHERE p.deleted_at IS NULL;

CREATE OR REPLACE VIEW compat.visite AS
SELECT
  rev.legacy_id::BIGINT AS id,
  enc.ambulatorio_id,
  p.legacy_id::BIGINT AS paziente_id,
  au.legacy_id::BIGINT AS medico_id,
  prev.legacy_id::BIGINT AS previous_version_id,
  CASE WHEN enc.current_revision_id = rev.id THEN 1 ELSE 0 END AS is_current_version,
  to_char(rev.visit_at AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD"T"HH24:MI') AS data_visita,
  rev.visit_type AS tipo_visita,
  rev.reason AS motivo,
  anth.height_cm::DOUBLE PRECISION AS altezza,
  anth.weight_kg::DOUBLE PRECISION AS peso,
  anth.bmi::DOUBLE PRECISION AS bmi,
  anth.bsa::DOUBLE PRECISION AS bsa,
  COALESCE(anam.cardiologica_text, '') AS anamnesi_cardiologica,
  COALESCE(anam.internistica_text, '') AS anamnesi_internistica,
  COALESCE(home.content_text, '') AS terapia_domiciliare,
  COALESCE(curr.content_text, '') AS valutazione_odierna,
  (
    SELECT jsonb_build_object(
      'data_ee', COALESCE(to_char(max(lr.exam_date), 'YYYY-MM-DD'), ''),
      'hb', COALESCE(max(lr.value_text) FILTER (WHERE lr.exam_code = 'hb'), ''),
      'plt', COALESCE(max(lr.value_text) FILTER (WHERE lr.exam_code = 'plt'), ''),
      'creatinina', COALESCE(max(lr.value_text) FILTER (WHERE lr.exam_code = 'creatinina'), ''),
      'egfr', COALESCE(max(lr.value_text) FILTER (WHERE lr.exam_code = 'egfr'), ''),
      'colesterolo_totale', COALESCE(max(lr.value_text) FILTER (WHERE lr.exam_code = 'colesterolo_totale'), ''),
      'hdl', COALESCE(max(lr.value_text) FILTER (WHERE lr.exam_code = 'hdl'), ''),
      'trigliceridi', COALESCE(max(lr.value_text) FILTER (WHERE lr.exam_code = 'trigliceridi'), ''),
      'ldl_calcolato', COALESCE(max(lr.value_text) FILTER (WHERE lr.exam_code = 'ldl_calcolato'), ''),
      'ldl_diretto', COALESCE(max(lr.value_text) FILTER (WHERE lr.exam_code = 'ldl_diretto'), ''),
      'lipoproteina_a', COALESCE(max(lr.value_text) FILTER (WHERE lr.exam_code = 'lipoproteina_a'), ''),
      'emoglobina_glicata', COALESCE(max(lr.value_text) FILTER (WHERE lr.exam_code = 'emoglobina_glicata'), ''),
      'glicemia', COALESCE(max(lr.value_text) FILTER (WHERE lr.exam_code = 'glicemia'), ''),
      'ast', COALESCE(max(lr.value_text) FILTER (WHERE lr.exam_code = 'ast'), ''),
      'alt', COALESCE(max(lr.value_text) FILTER (WHERE lr.exam_code = 'alt'), ''),
      'bilirubina_totale', COALESCE(max(lr.value_text) FILTER (WHERE lr.exam_code = 'bilirubina_totale'), ''),
      'cpk', COALESCE(max(lr.value_text) FILTER (WHERE lr.exam_code = 'cpk'), '')
    )::TEXT
    FROM clinical.encounter_lab_result lr
    WHERE lr.revision_id = rev.id
  ) AS esami_ematici,
  COALESCE(echo.payload_jsonb::TEXT, '{}') AS ecocardiografia,
  COALESCE(to_jsonb(fh) - 'revision_id', '{}'::jsonb)::TEXT AS fh_assessment,
  COALESCE(
    jsonb_build_object(
      'statine', jsonb_build_object('enabled', lt.statin_enabled, 'dose', lt.statin_dose),
      'ezetimibe', jsonb_build_object('enabled', lt.ezetimibe_enabled, 'modalita', lt.ezetimibe_mode),
      'fibrati', jsonb_build_object('enabled', lt.fibrati_enabled, 'dose', lt.fibrati_dose),
      'omega3', jsonb_build_object('enabled', lt.omega3_enabled, 'dose', lt.omega3_dose),
      'acido_bempedoico', jsonb_build_object('enabled', lt.acido_bempedoico_enabled, 'dose', lt.acido_bempedoico_dose),
      'repatha', jsonb_build_object('enabled', lt.repatha_enabled, 'dose', lt.repatha_dose),
      'praluent', jsonb_build_object('enabled', lt.praluent_enabled, 'dose', lt.praluent_dose),
      'leqvio', jsonb_build_object('enabled', lt.leqvio_enabled, 'dose', lt.leqvio_dose)
    ),
    '{}'::jsonb
  )::TEXT AS terapia_ipolipemizzante,
  COALESCE(to_jsonb(cvre) - 'revision_id', '{}'::jsonb)::TEXT AS valutazione_rischio_cv,
  (
    jsonb_build_object(
      'cardiologoNome', COALESCE((
        SELECT s.full_name
        FROM clinical.encounter_signature s
        WHERE s.revision_id = rev.id AND s.sign_role = 'cardiologo'
        ORDER BY s.display_order ASC
        LIMIT 1
      ), ''),
      'cardiologoTitolo', COALESCE((
        SELECT s.title
        FROM clinical.encounter_signature s
        WHERE s.revision_id = rev.id AND s.sign_role = 'cardiologo'
        ORDER BY s.display_order ASC
        LIMIT 1
      ), 'dott'),
      'mediciInFormazione', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('nome', s.full_name, 'titolo', s.title) ORDER BY s.display_order ASC)
        FROM clinical.encounter_signature s
        WHERE s.revision_id = rev.id AND s.sign_role = 'medico_formazione'
      ), '[]'::jsonb)
    )
  )::TEXT AS firme_visita,
  (
    jsonb_build_object(
      'dataOraProssimaVisita', COALESCE(to_char(conc.followup_at AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD"T"HH24:MI'), ''),
      'motivoProssimaVisita', COALESCE(conc.followup_reason, ''),
      'esamiEmaticiDaFare', COALESCE(conc.followup_tests, '')
    )
  )::TEXT AS pianificazione_followup,
  COALESCE(conc.conclusion_text, '') AS conclusioni,
  COALESCE((payload.payload_jsonb ->> 'anamnesi'), '') AS anamnesi,
  COALESCE((payload.payload_jsonb ->> 'esame_obiettivo'), '') AS esame_obiettivo,
  COALESCE(conc.diagnosis_text, COALESCE(payload.payload_jsonb ->> 'diagnosi', '')) AS diagnosi,
  COALESCE((payload.payload_jsonb ->> 'terapia'), '') AS terapia,
  COALESCE(conc.note_text, COALESCE(payload.payload_jsonb ->> 'note', '')) AS note,
  rev.created_at,
  enc.updated_at,
  p.first_name AS paziente_nome,
  p.last_name AS paziente_cognome,
  COALESCE(p.tax_code::TEXT, p.temporary_code, '') AS paziente_codice_fiscale,
  au.first_name AS medico_nome,
  au.last_name AS medico_cognome,
  rev.id AS internal_revision_id,
  enc.id AS internal_encounter_id
FROM clinical.encounter_revision rev
INNER JOIN clinical.encounter enc ON enc.id = rev.encounter_id
INNER JOIN patient.patient p ON p.id = enc.patient_id
INNER JOIN iam.app_user au ON au.id = rev.author_user_id
LEFT JOIN clinical.encounter_revision prev ON prev.id = rev.supersedes_revision_id
LEFT JOIN clinical.encounter_anthropometrics anth ON anth.revision_id = rev.id
LEFT JOIN clinical.encounter_anamnesis anam ON anam.revision_id = rev.id
LEFT JOIN clinical.encounter_home_therapy home ON home.revision_id = rev.id
LEFT JOIN clinical.encounter_current_evaluation curr ON curr.revision_id = rev.id
LEFT JOIN clinical.encounter_echocardiography echo ON echo.revision_id = rev.id
LEFT JOIN clinical.encounter_fh_assessment fh ON fh.revision_id = rev.id
LEFT JOIN clinical.encounter_lipid_therapy lt ON lt.revision_id = rev.id
LEFT JOIN clinical.encounter_cv_risk_evaluation cvre ON cvre.revision_id = rev.id
LEFT JOIN clinical.encounter_conclusion conc ON conc.revision_id = rev.id
LEFT JOIN LATERAL (
  SELECT elp.payload_jsonb
  FROM clinical.encounter_legacy_payload elp
  WHERE elp.revision_id = rev.id
  ORDER BY elp.created_at DESC
  LIMIT 1
) AS payload ON TRUE
WHERE enc.deleted_at IS NULL
  AND p.deleted_at IS NULL;

CREATE OR REPLACE VIEW compat.fattori_rischio_cv AS
SELECT
  rev.legacy_id::BIGINT AS id,
  rev.legacy_id::BIGINT AS visita_id,
  COALESCE(cv.familiarita, FALSE) AS familiarita,
  cv.familiarita_note,
  COALESCE(cv.ipertensione, FALSE) AS ipertensione,
  COALESCE(cv.diabete, FALSE) AS diabete,
  cv.diabete_durata,
  COALESCE(cv.diabete_tipo, '') AS diabete_tipo,
  COALESCE(cv.dislipidemia, FALSE) AS dislipidemia,
  COALESCE(cv.obesita, FALSE) AS obesita,
  COALESCE(cv.fumo, '') AS fumo,
  cv.fumo_ex_eta,
  rev.created_at,
  rev.created_at AS updated_at,
  rev.id AS internal_revision_id
FROM clinical.encounter_revision rev
LEFT JOIN clinical.encounter_cv_risk_factor cv ON cv.revision_id = rev.id;

CREATE OR REPLACE VIEW compat.appuntamenti AS
SELECT
  a.legacy_id::BIGINT AS id,
  a.ambulatorio_id,
  p.legacy_id::BIGINT AS paziente_id,
  to_char(a.start_at AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD"T"HH24:MI') AS data_ora_inizio,
  to_char(a.end_at AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD"T"HH24:MI') AS data_ora_fine,
  a.duration_minutes AS durata_minuti,
  a.reason AS motivo,
  CASE WHEN a.origin = 'followup_visit' THEN 'followup_visita' ELSE 'manuale' END AS origine,
  rev.legacy_id::BIGINT AS source_visita_id,
  a.created_at,
  a.updated_at,
  p.first_name AS paziente_nome,
  p.last_name AS paziente_cognome,
  COALESCE(p.tax_code::TEXT, p.temporary_code, '') AS paziente_codice_fiscale,
  p.birth_date::TEXT AS paziente_data_nascita,
  COALESCE(p.phone, '') AS paziente_telefono,
  a.id AS internal_id
FROM scheduling.appointment a
INNER JOIN patient.patient p ON p.id = a.patient_id
LEFT JOIN clinical.encounter_revision rev ON rev.id = a.source_encounter_revision_id
WHERE a.deleted_at IS NULL
  AND p.deleted_at IS NULL;
