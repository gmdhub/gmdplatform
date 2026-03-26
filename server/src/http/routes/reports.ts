import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { logAuditEvent } from '../../repos/audit-repo.js';
import { createReportMetadata, getReportsByEncounterRevision } from '../../repos/reports-repo.js';

const metadataSchema = z.object({
  encounter_revision_id: z.string().uuid(),
  template_code: z.string().min(1),
  template_name: z.string().min(1),
  template_version: z.number().int().positive(),
  storage_uri: z.string().min(1),
  file_sha256: z.string().length(64).optional().nullable(),
  file_size_bytes: z.number().int().nonnegative().optional().nullable(),
  mime_type: z.string().optional().nullable()
});

const idParams = z.object({ revisionId: z.string().uuid() });

export const reportRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/reports/metadata', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('reports.write')]
  }, async (request, reply) => {
    const parsed = metadataSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });
    }

    const created = await createReportMetadata({
      ...parsed.data,
      generated_by: request.auth?.userId ?? null
    });

    await logAuditEvent({
      actor_user_id: request.auth?.userId ?? null,
      action: 'create',
      entity_schema: 'reporting',
      entity_table: 'report_document',
      entity_pk: String(created?.id ?? ''),
      correlation_id: request.id,
      after_data: parsed.data
    });

    return reply.code(201).send(created);
  });

  fastify.get('/reports/by-encounter/:revisionId', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('reports.read')]
  }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid params', details: params.error.issues });
    }

    const rows = await getReportsByEncounterRevision(params.data.revisionId);
    return reply.send(rows);
  });
};
