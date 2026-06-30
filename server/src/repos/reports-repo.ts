import { query } from '../db/pool.js';

export async function createReportMetadata(input: {
  encounter_revision_id: string;
  template_code: string;
  template_name: string;
  template_version: number;
  storage_uri: string;
  file_sha256?: string | null;
  file_size_bytes?: number | null;
  mime_type?: string | null;
  generated_by?: string | null;
}) {
  const template = await query<{ id: string }>(
    `INSERT INTO reporting.report_template(code, name, version, storage_uri, is_active)
     VALUES ($1,$2,$3,$4,TRUE)
     ON CONFLICT (code)
     DO UPDATE SET
       name = EXCLUDED.name,
       version = EXCLUDED.version,
       storage_uri = EXCLUDED.storage_uri
     RETURNING id`,
    [input.template_code, input.template_name, input.template_version, input.storage_uri]
  );

  const templateRow = template.rows[0];
  if (!templateRow?.id) {
    throw new Error('Impossibile risolvere template referto');
  }
  const templateId = templateRow.id;

  const nextVersion = await query<{ next_version: number }>(
    `SELECT COALESCE(MAX(version_no), 0) + 1 AS next_version
     FROM reporting.report_document
     WHERE encounter_revision_id = $1`,
    [input.encounter_revision_id]
  );

  const versionNo = Number(nextVersion.rows[0]?.next_version ?? 1);

  const document = await query<{ id: string; version_no: number }>(
    `INSERT INTO reporting.report_document(
      encounter_revision_id,
      template_id,
      version_no,
      status,
      storage_uri,
      file_sha256,
      file_size_bytes,
      mime_type,
      generated_by
    ) VALUES ($1,$2,$3,'generated',$4,$5,$6,$7,$8)
    RETURNING id, version_no`,
    [
      input.encounter_revision_id,
      templateId,
      versionNo,
      input.storage_uri,
      input.file_sha256 ?? null,
      input.file_size_bytes ?? null,
      input.mime_type ?? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      input.generated_by ?? null
    ]
  );

  return document.rows[0] ?? null;
}

export async function getReportsByEncounterRevision(encounterRevisionId: string) {
  const result = await query(
    `SELECT d.*, t.code AS template_code, t.name AS template_name, t.version AS template_version
     FROM reporting.report_document d
     INNER JOIN reporting.report_template t ON t.id = d.template_id
     WHERE d.encounter_revision_id = $1
     ORDER BY d.version_no DESC`,
    [encounterRevisionId]
  );

  return result.rows;
}
