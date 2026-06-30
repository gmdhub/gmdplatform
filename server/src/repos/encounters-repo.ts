import type { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pool.js';

type ClinicalDataInput = {
  anthropometrics?: { height_cm?: number | null; weight_kg?: number | null; bmi?: number | null; bsa?: number | null };
  anamnesis?: { cardiologica_text?: string | null; internistica_text?: string | null };
  cv_risk_factor?: {
    familiarita?: boolean;
    familiarita_note?: string | null;
    ipertensione?: boolean;
    diabete?: boolean;
    diabete_durata?: string | null;
    diabete_tipo?: '' | '1' | '2';
    dislipidemia?: boolean;
    obesita?: boolean;
    fumo?: string;
    fumo_ex_eta?: string | null;
  };
  fh_assessment?: Record<string, unknown>;
  lipid_therapy?: Record<string, unknown>;
  home_therapy?: { content_text?: string | null };
  current_evaluation?: { content_text?: string | null };
  lab_results?: Array<{ exam_code: string; exam_date?: string | null; value_text?: string | null; value_numeric?: number | null; unit?: string | null }>;
  cv_risk_evaluation?: {
    risk_level?: '' | 'basso' | 'moderato' | 'alto' | 'molto_alto';
    target_ldl?: number | null;
    current_ldl?: number | null;
    ldl_source?: '' | 'diretto' | 'calcolato';
    status?: 'non_valutabile' | 'raggiunto' | 'non_raggiunto';
    status_message?: string;
  };
  echocardiography?: Record<string, unknown>;
  conclusion?: {
    conclusion_text?: string | null;
    diagnosis_text?: string | null;
    note_text?: string | null;
    followup_at?: string | null;
    followup_reason?: string | null;
    followup_tests?: string | null;
  };
  signatures?: Array<{ sign_role: 'cardiologo' | 'medico_formazione'; full_name: string; title: 'dott' | 'dott.ssa'; display_order?: number }>;
  legacy_payload?: Record<string, unknown>;
};

async function persistRevisionBlocks(client: PoolClient, revisionId: string, data: ClinicalDataInput): Promise<void> {
  if (data.anthropometrics) {
    await client.query(
      `INSERT INTO clinical.encounter_anthropometrics(revision_id, height_cm, weight_kg, bmi, bsa)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        revisionId,
        data.anthropometrics.height_cm ?? null,
        data.anthropometrics.weight_kg ?? null,
        data.anthropometrics.bmi ?? null,
        data.anthropometrics.bsa ?? null
      ]
    );
  }

  if (data.anamnesis) {
    await client.query(
      `INSERT INTO clinical.encounter_anamnesis(revision_id, cardiologica_text, internistica_text)
       VALUES ($1, $2, $3)`,
      [revisionId, data.anamnesis.cardiologica_text ?? null, data.anamnesis.internistica_text ?? null]
    );
  }

  if (data.cv_risk_factor) {
    await client.query(
      `INSERT INTO clinical.encounter_cv_risk_factor(
        revision_id,
        familiarita,
        familiarita_note,
        ipertensione,
        diabete,
        diabete_durata,
        diabete_tipo,
        dislipidemia,
        obesita,
        fumo,
        fumo_ex_eta
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        revisionId,
        Boolean(data.cv_risk_factor.familiarita),
        data.cv_risk_factor.familiarita_note ?? null,
        Boolean(data.cv_risk_factor.ipertensione),
        Boolean(data.cv_risk_factor.diabete),
        data.cv_risk_factor.diabete_durata ?? null,
        data.cv_risk_factor.diabete_tipo ?? '',
        Boolean(data.cv_risk_factor.dislipidemia),
        Boolean(data.cv_risk_factor.obesita),
        data.cv_risk_factor.fumo ?? '',
        data.cv_risk_factor.fumo_ex_eta ?? null
      ]
    );
  }

  if (data.fh_assessment) {
    await client.query(
      `INSERT INTO clinical.encounter_fh_assessment(
        revision_id,
        enabled,
        family_history_one_point,
        family_history_two_points,
        clinical_premature_cad,
        clinical_premature_cerebral_or_peripheral,
        physical_tendon_xanthomas,
        physical_corneal_arcus_before45,
        untreated_ldl_range,
        genetic_mutation,
        total_score,
        classification
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        revisionId,
        Boolean(data.fh_assessment.enabled),
        Boolean(data.fh_assessment.family_history_one_point),
        Boolean(data.fh_assessment.family_history_two_points),
        Boolean(data.fh_assessment.clinical_premature_cad),
        Boolean(data.fh_assessment.clinical_premature_cerebral_or_peripheral),
        Boolean(data.fh_assessment.physical_tendon_xanthomas),
        Boolean(data.fh_assessment.physical_corneal_arcus_before45),
        String(data.fh_assessment.untreated_ldl_range ?? ''),
        Boolean(data.fh_assessment.genetic_mutation),
        Number(data.fh_assessment.total_score ?? 0),
        String(data.fh_assessment.classification ?? 'Improbabile')
      ]
    );
  }

  if (data.lipid_therapy) {
    const l = data.lipid_therapy as Record<string, any>;
    await client.query(
      `INSERT INTO clinical.encounter_lipid_therapy(
        revision_id,
        statin_enabled, statin_dose,
        ezetimibe_enabled, ezetimibe_mode,
        fibrati_enabled, fibrati_dose,
        omega3_enabled, omega3_dose,
        acido_bempedoico_enabled, acido_bempedoico_dose,
        repatha_enabled, repatha_dose,
        praluent_enabled, praluent_dose,
        leqvio_enabled, leqvio_dose
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        revisionId,
        Boolean(l.statine?.enabled), l.statine?.dose ?? '',
        Boolean(l.ezetimibe?.enabled), l.ezetimibe?.modalita ?? '',
        Boolean(l.fibrati?.enabled), l.fibrati?.dose ?? '',
        Boolean(l.omega3?.enabled), l.omega3?.dose ?? '',
        Boolean(l.acido_bempedoico?.enabled), l.acido_bempedoico?.dose ?? '',
        Boolean(l.repatha?.enabled), l.repatha?.dose ?? '',
        Boolean(l.praluent?.enabled), l.praluent?.dose ?? '',
        Boolean(l.leqvio?.enabled), l.leqvio?.dose ?? ''
      ]
    );
  }

  if (data.home_therapy) {
    await client.query(
      `INSERT INTO clinical.encounter_home_therapy(revision_id, content_text)
       VALUES ($1, $2)`,
      [revisionId, data.home_therapy.content_text ?? null]
    );
  }

  if (data.current_evaluation) {
    await client.query(
      `INSERT INTO clinical.encounter_current_evaluation(revision_id, content_text)
       VALUES ($1, $2)`,
      [revisionId, data.current_evaluation.content_text ?? null]
    );
  }

  if (Array.isArray(data.lab_results) && data.lab_results.length > 0) {
    for (const row of data.lab_results) {
      await client.query(
        `INSERT INTO clinical.encounter_lab_result(revision_id, exam_code, exam_date, value_text, value_numeric, unit)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [revisionId, row.exam_code, row.exam_date ?? null, row.value_text ?? null, row.value_numeric ?? null, row.unit ?? null]
      );
    }
  }

  if (data.cv_risk_evaluation) {
    await client.query(
      `INSERT INTO clinical.encounter_cv_risk_evaluation(
        revision_id,
        risk_level,
        target_ldl,
        current_ldl,
        ldl_source,
        status,
        status_message
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        revisionId,
        data.cv_risk_evaluation.risk_level ?? '',
        data.cv_risk_evaluation.target_ldl ?? null,
        data.cv_risk_evaluation.current_ldl ?? null,
        data.cv_risk_evaluation.ldl_source ?? '',
        data.cv_risk_evaluation.status ?? 'non_valutabile',
        data.cv_risk_evaluation.status_message ?? ''
      ]
    );
  }

  if (data.echocardiography) {
    await client.query(
      `INSERT INTO clinical.encounter_echocardiography(revision_id, schema_version, payload_jsonb)
       VALUES ($1, 1, $2::jsonb)`,
      [revisionId, JSON.stringify(data.echocardiography)]
    );
  }

  if (data.conclusion) {
    await client.query(
      `INSERT INTO clinical.encounter_conclusion(
        revision_id,
        conclusion_text,
        diagnosis_text,
        note_text,
        followup_at,
        followup_reason,
        followup_tests
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        revisionId,
        data.conclusion.conclusion_text ?? null,
        data.conclusion.diagnosis_text ?? null,
        data.conclusion.note_text ?? null,
        data.conclusion.followup_at ?? null,
        data.conclusion.followup_reason ?? null,
        data.conclusion.followup_tests ?? null
      ]
    );
  }

  if (Array.isArray(data.signatures) && data.signatures.length > 0) {
    for (const signature of data.signatures) {
      await client.query(
        `INSERT INTO clinical.encounter_signature(revision_id, sign_role, full_name, title, display_order)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          revisionId,
          signature.sign_role,
          signature.full_name,
          signature.title,
          signature.display_order ?? 1
        ]
      );
    }
  }

  if (data.legacy_payload) {
    await client.query(
      `INSERT INTO clinical.encounter_legacy_payload(revision_id, source, payload_jsonb)
       VALUES ($1, 'frontend_payload', $2::jsonb)`,
      [revisionId, JSON.stringify(data.legacy_payload)]
    );
  }
}

export async function listEncounters(params: {
  ambulatorioId?: number;
  patientId?: string;
  limit?: number;
  offset?: number;
}) {
  const values: unknown[] = [];
  const where: string[] = ['e.deleted_at IS NULL'];

  if (params.ambulatorioId) {
    values.push(params.ambulatorioId);
    where.push(`e.ambulatorio_id = $${values.length}`);
  }

  if (params.patientId) {
    values.push(params.patientId);
    where.push(`e.patient_id = $${values.length}`);
  }

  const limit = Math.max(1, Math.min(params.limit ?? 100, 500));
  const offset = Math.max(0, params.offset ?? 0);
  values.push(limit);
  values.push(offset);

  const result = await query(
    `SELECT
       e.id,
       e.ambulatorio_id,
       e.patient_id,
       e.status,
       e.current_revision_id,
       e.created_at,
       e.updated_at,
       r.visit_at,
       r.visit_type,
       r.reason,
       r.revision_no
     FROM clinical.encounter e
     LEFT JOIN clinical.encounter_revision r ON r.id = e.current_revision_id
     WHERE ${where.join(' AND ')}
     ORDER BY e.updated_at DESC
     LIMIT $${values.length - 1}
     OFFSET $${values.length}`,
    values
  );

  return result.rows;
}

export async function getEncounterRevisions(encounterId: string) {
  const result = await query(
    `SELECT *
     FROM clinical.encounter_revision
     WHERE encounter_id = $1
     ORDER BY revision_no DESC`,
    [encounterId]
  );
  return result.rows;
}

export async function createEncounterWithRevision(input: {
  ambulatorio_id: number;
  patient_id: string;
  status?: 'draft' | 'completed' | 'signed' | 'cancelled';
  visit_at: string;
  visit_type: string;
  reason: string;
  actor_user_id: string;
  clinical_data?: ClinicalDataInput;
}) {
  return withTransaction(async (client) => {
    const encounterInsert = await client.query<{ id: string }>(
      `INSERT INTO clinical.encounter(
        ambulatorio_id,
        patient_id,
        status,
        created_by
      ) VALUES ($1,$2,$3,$4)
      RETURNING id`,
      [
        input.ambulatorio_id,
        input.patient_id,
        input.status ?? 'completed',
        input.actor_user_id
      ]
    );

    const encounterRow = encounterInsert.rows[0];
    if (!encounterRow?.id) {
      throw new Error('Impossibile creare encounter');
    }
    const encounterId = encounterRow.id;

    const revisionInsert = await client.query<{ id: string }>(
      `INSERT INTO clinical.encounter_revision(
        encounter_id,
        revision_no,
        visit_at,
        visit_type,
        reason,
        author_user_id
      ) VALUES ($1,1,$2,$3,$4,$5)
      RETURNING id`,
      [
        encounterId,
        input.visit_at,
        input.visit_type,
        input.reason,
        input.actor_user_id
      ]
    );

    const revisionRow = revisionInsert.rows[0];
    if (!revisionRow?.id) {
      throw new Error('Impossibile creare revisione encounter');
    }
    const revisionId = revisionRow.id;

    await client.query(
      `UPDATE clinical.encounter
       SET current_revision_id = $1
       WHERE id = $2`,
      [revisionId, encounterId]
    );

    if (input.clinical_data) {
      await persistRevisionBlocks(client, revisionId, input.clinical_data);
    }

    return { encounterId, revisionId };
  });
}

export async function createEncounterRevision(input: {
  encounter_id: string;
  visit_at: string;
  visit_type: string;
  reason: string;
  actor_user_id: string;
  clinical_data?: ClinicalDataInput;
}) {
  return withTransaction(async (client) => {
    await client.query(
      `SELECT id
       FROM clinical.encounter
       WHERE id = $1
       FOR UPDATE`,
      [input.encounter_id]
    );

    const current = await client.query<{ revision_no: number }>(
      `SELECT COALESCE(MAX(revision_no), 0) AS revision_no
       FROM clinical.encounter_revision
       WHERE encounter_id = $1`,
      [input.encounter_id]
    );

    const nextRevisionNo = Number(current.rows[0]?.revision_no ?? 0) + 1;

    const prev = await client.query<{ id: string }>(
      `SELECT id
       FROM clinical.encounter_revision
       WHERE encounter_id = $1
       ORDER BY revision_no DESC
       LIMIT 1`,
      [input.encounter_id]
    );

    const prevRevisionId = prev.rows[0]?.id ?? null;

    const revisionInsert = await client.query<{ id: string }>(
      `INSERT INTO clinical.encounter_revision(
        encounter_id,
        revision_no,
        supersedes_revision_id,
        visit_at,
        visit_type,
        reason,
        author_user_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id`,
      [
        input.encounter_id,
        nextRevisionNo,
        prevRevisionId,
        input.visit_at,
        input.visit_type,
        input.reason,
        input.actor_user_id
      ]
    );

    const revisionRow = revisionInsert.rows[0];
    if (!revisionRow?.id) {
      throw new Error('Impossibile creare revisione encounter');
    }
    const revisionId = revisionRow.id;

    await client.query(
      `UPDATE clinical.encounter
       SET current_revision_id = $1,
           updated_at = now()
       WHERE id = $2`,
      [revisionId, input.encounter_id]
    );

    if (input.clinical_data) {
      await persistRevisionBlocks(client, revisionId, input.clinical_data);
    }

    return { revisionId, revision_no: nextRevisionNo };
  });
}
