CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS org;
CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS patient;
CREATE SCHEMA IF NOT EXISTS clinical;
CREATE SCHEMA IF NOT EXISTS scheduling;
CREATE SCHEMA IF NOT EXISTS reporting;
CREATE SCHEMA IF NOT EXISTS audit;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS org.ambulatorio (
  id BIGSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org.ambulatorio_settings (
  ambulatorio_id BIGINT PRIMARY KEY REFERENCES org.ambulatorio(id) ON DELETE CASCADE,
  min_visit_minutes SMALLINT NOT NULL CHECK (min_visit_minutes >= 10),
  standard_visit_minutes SMALLINT NOT NULL CHECK (standard_visit_minutes >= min_visit_minutes),
  report_base_uri TEXT,
  timezone TEXT NOT NULL DEFAULT 'Europe/Rome',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org.ambulatorio_theme (
  ambulatorio_id BIGINT PRIMARY KEY REFERENCES org.ambulatorio(id) ON DELETE CASCADE,
  logo_path TEXT,
  color_primary TEXT NOT NULL DEFAULT '#1e3a8a',
  color_secondary TEXT NOT NULL DEFAULT '#3b82f6',
  color_accent TEXT NOT NULL DEFAULT '#22d3ee'
);

CREATE TABLE IF NOT EXISTS org.ambulatorio_operating_window (
  id BIGSERIAL PRIMARY KEY,
  ambulatorio_id BIGINT NOT NULL REFERENCES org.ambulatorio(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  max_patients_per_day INTEGER NOT NULL CHECK (max_patients_per_day >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_window_range CHECK (start_time < end_time),
  CONSTRAINT ux_window UNIQUE (ambulatorio_id, weekday, start_time, end_time)
);

CREATE TABLE IF NOT EXISTS iam.app_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  username CITEXT UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email CITEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'locked')),
  is_service_account BOOLEAN NOT NULL DEFAULT FALSE,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS iam.user_credential (
  user_id UUID PRIMARY KEY REFERENCES iam.app_user(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_algo TEXT NOT NULL DEFAULT 'bcrypt',
  must_rotate BOOLEAN NOT NULL DEFAULT FALSE,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS iam.role (
  id BIGSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS iam.permission (
  id BIGSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS iam.role_permission (
  role_id BIGINT NOT NULL REFERENCES iam.role(id) ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES iam.permission(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS iam.user_role (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES iam.app_user(id) ON DELETE CASCADE,
  role_id BIGINT NOT NULL REFERENCES iam.role(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'ambulatorio')),
  scope_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_scope CHECK (
    (scope_type = 'global' AND scope_id IS NULL) OR
    (scope_type = 'ambulatorio' AND scope_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_user_role_scope
  ON iam.user_role(user_id, role_id, scope_type, COALESCE(scope_id, 0));

CREATE TABLE IF NOT EXISTS iam.user_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES iam.app_user(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  device_info JSONB,
  ip_address INET
);

CREATE INDEX IF NOT EXISTS idx_user_session_user ON iam.user_session(user_id);
CREATE INDEX IF NOT EXISTS idx_user_session_exp ON iam.user_session(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_session_refresh ON iam.user_session(refresh_token_hash);

CREATE TABLE IF NOT EXISTS patient.patient (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  ambulatorio_id BIGINT NOT NULL REFERENCES org.ambulatorio(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  birth_date DATE NOT NULL,
  birth_place TEXT NOT NULL,
  sex TEXT NOT NULL CHECK (sex IN ('M', 'F', 'Altro')),
  tax_code CITEXT,
  temporary_code TEXT,
  exemptions TEXT,
  address TEXT,
  city TEXT,
  cap TEXT,
  province TEXT,
  phone TEXT,
  email TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES iam.app_user(id),
  updated_by UUID REFERENCES iam.app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_patient_tax_code_valid
  ON patient.patient ((upper(tax_code)))
  WHERE tax_code IS NOT NULL AND length(tax_code) = 16 AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_patient_ambulatorio_name
  ON patient.patient(ambulatorio_id, last_name, first_name);

CREATE INDEX IF NOT EXISTS idx_patient_active
  ON patient.patient(is_active)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS patient.patient_contact (
  id BIGSERIAL PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patient.patient(id) ON DELETE CASCADE,
  contact_type TEXT NOT NULL CHECK (contact_type IN ('phone', 'email', 'address', 'emergency')),
  contact_value TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clinical.encounter (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  ambulatorio_id BIGINT NOT NULL REFERENCES org.ambulatorio(id),
  patient_id UUID NOT NULL REFERENCES patient.patient(id),
  status TEXT NOT NULL CHECK (status IN ('draft', 'completed', 'signed', 'cancelled')),
  current_revision_id UUID,
  created_by UUID NOT NULL REFERENCES iam.app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS clinical.encounter_revision (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  encounter_id UUID NOT NULL REFERENCES clinical.encounter(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  supersedes_revision_id UUID REFERENCES clinical.encounter_revision(id),
  visit_at TIMESTAMPTZ NOT NULL,
  visit_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  author_user_id UUID NOT NULL REFERENCES iam.app_user(id),
  signed_at TIMESTAMPTZ,
  signed_by UUID REFERENCES iam.app_user(id),
  is_void BOOLEAN NOT NULL DEFAULT FALSE,
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (encounter_id, revision_no)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_encounter_current_revision'
      AND conrelid = 'clinical.encounter'::regclass
  ) THEN
    ALTER TABLE clinical.encounter
      ADD CONSTRAINT fk_encounter_current_revision
      FOREIGN KEY (current_revision_id) REFERENCES clinical.encounter_revision(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_encounter_patient_visit
  ON clinical.encounter(patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_encounter_ambulatorio
  ON clinical.encounter(ambulatorio_id, created_at DESC);

CREATE TABLE IF NOT EXISTS clinical.encounter_anthropometrics (
  revision_id UUID PRIMARY KEY REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  height_cm NUMERIC(5,2),
  weight_kg NUMERIC(5,2),
  bmi NUMERIC(5,2),
  bsa NUMERIC(5,2)
);

CREATE TABLE IF NOT EXISTS clinical.encounter_anamnesis (
  revision_id UUID PRIMARY KEY REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  cardiologica_text TEXT,
  internistica_text TEXT
);

CREATE TABLE IF NOT EXISTS clinical.encounter_cv_risk_factor (
  revision_id UUID PRIMARY KEY REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  familiarita BOOLEAN NOT NULL DEFAULT FALSE,
  familiarita_note TEXT,
  ipertensione BOOLEAN NOT NULL DEFAULT FALSE,
  diabete BOOLEAN NOT NULL DEFAULT FALSE,
  diabete_durata TEXT,
  diabete_tipo TEXT NOT NULL DEFAULT '' CHECK (diabete_tipo IN ('', '1', '2')),
  dislipidemia BOOLEAN NOT NULL DEFAULT FALSE,
  obesita BOOLEAN NOT NULL DEFAULT FALSE,
  fumo TEXT NOT NULL DEFAULT '',
  fumo_ex_eta TEXT
);

CREATE TABLE IF NOT EXISTS clinical.encounter_fh_assessment (
  revision_id UUID PRIMARY KEY REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  family_history_one_point BOOLEAN NOT NULL DEFAULT FALSE,
  family_history_two_points BOOLEAN NOT NULL DEFAULT FALSE,
  clinical_premature_cad BOOLEAN NOT NULL DEFAULT FALSE,
  clinical_premature_cerebral_or_peripheral BOOLEAN NOT NULL DEFAULT FALSE,
  physical_tendon_xanthomas BOOLEAN NOT NULL DEFAULT FALSE,
  physical_corneal_arcus_before45 BOOLEAN NOT NULL DEFAULT FALSE,
  untreated_ldl_range TEXT NOT NULL DEFAULT '',
  genetic_mutation BOOLEAN NOT NULL DEFAULT FALSE,
  total_score INTEGER NOT NULL DEFAULT 0,
  classification TEXT NOT NULL DEFAULT 'Improbabile'
);

CREATE TABLE IF NOT EXISTS clinical.encounter_lipid_therapy (
  revision_id UUID PRIMARY KEY REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  statin_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  statin_dose TEXT NOT NULL DEFAULT '',
  ezetimibe_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ezetimibe_mode TEXT NOT NULL DEFAULT '',
  fibrati_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  fibrati_dose TEXT NOT NULL DEFAULT '',
  omega3_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  omega3_dose TEXT NOT NULL DEFAULT '',
  acido_bempedoico_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  acido_bempedoico_dose TEXT NOT NULL DEFAULT '',
  repatha_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  repatha_dose TEXT NOT NULL DEFAULT '',
  praluent_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  praluent_dose TEXT NOT NULL DEFAULT '',
  leqvio_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  leqvio_dose TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS clinical.encounter_home_therapy (
  revision_id UUID PRIMARY KEY REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  content_text TEXT
);

CREATE TABLE IF NOT EXISTS clinical.encounter_current_evaluation (
  revision_id UUID PRIMARY KEY REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  content_text TEXT
);

CREATE TABLE IF NOT EXISTS clinical.encounter_lab_result (
  revision_id UUID NOT NULL REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  exam_code TEXT NOT NULL CHECK (exam_code IN (
    'hb',
    'plt',
    'creatinina',
    'egfr',
    'colesterolo_totale',
    'hdl',
    'trigliceridi',
    'ldl_calcolato',
    'ldl_diretto',
    'lipoproteina_a',
    'emoglobina_glicata',
    'glicemia',
    'ast',
    'alt',
    'bilirubina_totale',
    'cpk'
  )),
  exam_date DATE,
  value_text TEXT,
  value_numeric NUMERIC(10,3),
  unit TEXT,
  PRIMARY KEY (revision_id, exam_code)
);

CREATE TABLE IF NOT EXISTS clinical.encounter_cv_risk_evaluation (
  revision_id UUID PRIMARY KEY REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  risk_level TEXT NOT NULL DEFAULT '' CHECK (risk_level IN ('', 'basso', 'moderato', 'alto', 'molto_alto')),
  target_ldl NUMERIC(10,3),
  current_ldl NUMERIC(10,3),
  ldl_source TEXT NOT NULL DEFAULT '' CHECK (ldl_source IN ('', 'diretto', 'calcolato')),
  status TEXT NOT NULL DEFAULT 'non_valutabile' CHECK (status IN ('non_valutabile', 'raggiunto', 'non_raggiunto')),
  status_message TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS clinical.encounter_echocardiography (
  revision_id UUID PRIMARY KEY REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL DEFAULT 1,
  payload_jsonb JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS clinical.encounter_conclusion (
  revision_id UUID PRIMARY KEY REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  conclusion_text TEXT,
  diagnosis_text TEXT,
  note_text TEXT,
  followup_at TIMESTAMPTZ,
  followup_reason TEXT,
  followup_tests TEXT
);

CREATE TABLE IF NOT EXISTS clinical.encounter_signature (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id UUID NOT NULL REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  sign_role TEXT NOT NULL CHECK (sign_role IN ('cardiologo', 'medico_formazione')),
  full_name TEXT NOT NULL,
  title TEXT NOT NULL CHECK (title IN ('dott', 'dott.ssa')),
  display_order INTEGER NOT NULL DEFAULT 1,
  UNIQUE (revision_id, sign_role, display_order)
);

CREATE TABLE IF NOT EXISTS clinical.encounter_legacy_payload (
  id BIGSERIAL PRIMARY KEY,
  revision_id UUID NOT NULL REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  payload_jsonb JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_encounter_legacy_payload_revision
  ON clinical.encounter_legacy_payload(revision_id, created_at DESC);

CREATE TABLE IF NOT EXISTS scheduling.appointment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  ambulatorio_id BIGINT NOT NULL REFERENCES org.ambulatorio(id),
  patient_id UUID NOT NULL REFERENCES patient.patient(id),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 10),
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')),
  reason TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('manual', 'followup_visit')),
  source_encounter_revision_id UUID REFERENCES clinical.encounter_revision(id),
  created_by UUID REFERENCES iam.app_user(id),
  updated_by UUID REFERENCES iam.app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT ck_appointment_range CHECK (start_at < end_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_appointment_source_revision
  ON scheduling.appointment(source_encounter_revision_id)
  WHERE source_encounter_revision_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_appointment_ambulatorio_time
  ON scheduling.appointment(ambulatorio_id, start_at, end_at)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS reporting.report_template (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  storage_uri TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reporting.report_document (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_revision_id UUID NOT NULL REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES reporting.report_template(id),
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  status TEXT NOT NULL CHECK (status IN ('generated', 'signed', 'archived', 'failed')),
  storage_uri TEXT NOT NULL,
  file_sha256 CHAR(64),
  file_size_bytes BIGINT,
  mime_type TEXT NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  generated_by UUID REFERENCES iam.app_user(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  signed_at TIMESTAMPTZ,
  signed_by UUID REFERENCES iam.app_user(id),
  UNIQUE (encounter_revision_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_report_enc_rev
  ON reporting.report_document(encounter_revision_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS audit.audit_event (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id UUID REFERENCES iam.app_user(id),
  action TEXT NOT NULL,
  entity_schema TEXT NOT NULL,
  entity_table TEXT NOT NULL,
  entity_pk TEXT NOT NULL,
  ambulatorio_id BIGINT,
  patient_id UUID,
  correlation_id UUID,
  app_version TEXT,
  device_id TEXT,
  ip_address INET,
  before_data JSONB,
  after_data JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_occurred
  ON audit.audit_event(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_patient
  ON audit.audit_event(patient_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS audit.patient_access_log (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id UUID NOT NULL REFERENCES iam.app_user(id),
  patient_id UUID NOT NULL REFERENCES patient.patient(id),
  encounter_id UUID REFERENCES clinical.encounter(id),
  access_type TEXT NOT NULL CHECK (access_type IN ('view_patient', 'view_encounter', 'view_report', 'export_report')),
  reason TEXT,
  correlation_id UUID
);

CREATE INDEX IF NOT EXISTS idx_patient_access_patient
  ON audit.patient_access_log(patient_id, occurred_at DESC);

DROP TRIGGER IF EXISTS trg_ambulatorio_updated ON org.ambulatorio;
CREATE TRIGGER trg_ambulatorio_updated
  BEFORE UPDATE ON org.ambulatorio
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_ambulatorio_settings_updated ON org.ambulatorio_settings;
CREATE TRIGGER trg_ambulatorio_settings_updated
  BEFORE UPDATE ON org.ambulatorio_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_operating_window_updated ON org.ambulatorio_operating_window;
CREATE TRIGGER trg_operating_window_updated
  BEFORE UPDATE ON org.ambulatorio_operating_window
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_app_user_updated ON iam.app_user;
CREATE TRIGGER trg_app_user_updated
  BEFORE UPDATE ON iam.app_user
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_patient_updated ON patient.patient;
CREATE TRIGGER trg_patient_updated
  BEFORE UPDATE ON patient.patient
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_encounter_updated ON clinical.encounter;
CREATE TRIGGER trg_encounter_updated
  BEFORE UPDATE ON clinical.encounter
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_appointment_updated ON scheduling.appointment;
CREATE TRIGGER trg_appointment_updated
  BEFORE UPDATE ON scheduling.appointment
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
