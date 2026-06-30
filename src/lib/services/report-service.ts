import { apiGet, apiPost } from './http-client';

export async function createReportMetadata(payload: {
  encounter_revision_id: string;
  template_code: string;
  template_name: string;
  template_version: number;
  storage_uri: string;
  file_sha256?: string | null;
  file_size_bytes?: number | null;
  mime_type?: string | null;
}) {
  return apiPost('/reports/metadata', payload);
}

export async function getReportsByEncounterRevision(revisionId: string) {
  return apiGet(`/reports/by-encounter/${revisionId}`);
}
