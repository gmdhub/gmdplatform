SELECT setval(
  'iam.app_user_legacy_id_seq',
  COALESCE((SELECT MAX(legacy_id) FROM iam.app_user), 0) + 1,
  false
);

SELECT setval(
  'patient.patient_legacy_id_seq',
  COALESCE((SELECT MAX(legacy_id) FROM patient.patient), 0) + 1,
  false
);

SELECT setval(
  'clinical.encounter_legacy_id_seq',
  COALESCE((SELECT MAX(legacy_id) FROM clinical.encounter), 0) + 1,
  false
);

SELECT setval(
  'clinical.encounter_revision_legacy_id_seq',
  COALESCE((SELECT MAX(legacy_id) FROM clinical.encounter_revision), 0) + 1,
  false
);

SELECT setval(
  'scheduling.appointment_legacy_id_seq',
  COALESCE((SELECT MAX(legacy_id) FROM scheduling.appointment), 0) + 1,
  false
);
