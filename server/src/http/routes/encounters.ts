import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { logAuditEvent, logPatientAccess, logPatientAccessBatch } from '../../repos/audit-repo.js';
import {
  createEncounterRevision,
  createEncounterWithRevision,
  getEncounterRevisions,
  listEncounters
} from '../../repos/encounters-repo.js';

const listQuerySchema = z.object({
  ambulatorio_id: z.coerce.number().int().positive().optional(),
  patient_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().min(0).optional()
});

const clinicalDataSchema = z.object({
  anthropometrics: z
    .object({
      height_cm: z.number().optional().nullable(),
      weight_kg: z.number().optional().nullable(),
      bmi: z.number().optional().nullable(),
      bsa: z.number().optional().nullable()
    })
    .optional(),
  anamnesis: z
    .object({
      cardiologica_text: z.string().optional().nullable(),
      internistica_text: z.string().optional().nullable()
    })
    .optional(),
  cv_risk_factor: z.record(z.string(), z.unknown()).optional(),
  fh_assessment: z.record(z.string(), z.unknown()).optional(),
  lipid_therapy: z.record(z.string(), z.unknown()).optional(),
  home_therapy: z.object({ content_text: z.string().optional().nullable() }).optional(),
  current_evaluation: z.object({ content_text: z.string().optional().nullable() }).optional(),
  lab_results: z
    .array(
      z.object({
        exam_code: z.string(),
        exam_date: z.string().optional().nullable(),
        value_text: z.string().optional().nullable(),
        value_numeric: z.number().optional().nullable(),
        unit: z.string().optional().nullable()
      })
    )
    .optional(),
  cv_risk_evaluation: z.record(z.string(), z.unknown()).optional(),
  echocardiography: z.record(z.string(), z.unknown()).optional(),
  conclusion: z.record(z.string(), z.unknown()).optional(),
  signatures: z
    .array(
      z.object({
        sign_role: z.enum(['cardiologo', 'medico_formazione']),
        full_name: z.string().min(1),
        title: z.enum(['dott', 'dott.ssa']),
        display_order: z.number().int().positive().optional()
      })
    )
    .optional(),
  legacy_payload: z.record(z.string(), z.unknown()).optional()
});

const createSchema = z.object({
  ambulatorio_id: z.number().int().positive(),
  patient_id: z.string().uuid(),
  status: z.enum(['draft', 'completed', 'signed', 'cancelled']).optional(),
  visit_at: z.string().min(1),
  visit_type: z.string().min(1),
  reason: z.string().min(1),
  clinical_data: clinicalDataSchema.optional()
});

const revisionSchema = z.object({
  visit_at: z.string().min(1),
  visit_type: z.string().min(1),
  reason: z.string().min(1),
  clinical_data: clinicalDataSchema.optional()
});

const idParams = z.object({ id: z.string().uuid() });

export const encounterRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/encounters', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('encounters.read')]
  }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query', details: parsed.error.issues });
    }

    const rows = await listEncounters({
      ambulatorioId: parsed.data.ambulatorio_id,
      patientId: parsed.data.patient_id,
      limit: parsed.data.limit,
      offset: parsed.data.offset
    });

    if (request.auth?.userId) {
      const items = rows
        .filter((row) => Boolean(row.patient_id))
        .map((row) => ({
          patient_id: String(row.patient_id),
          encounter_id: String(row.id)
        }));

      await logPatientAccessBatch({
        actor_user_id: request.auth.userId,
        access_type: 'view_encounter',
        reason: 'encounter_list_query',
        correlation_id: request.id,
        items
      });
    }

    return reply.send(rows);
  });

  fastify.post('/encounters', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('encounters.write')]
  }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });
    }

    if (!request.auth?.userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const created = await createEncounterWithRevision({
      ...parsed.data,
      actor_user_id: request.auth.userId
    });

    await logAuditEvent({
      actor_user_id: request.auth.userId,
      action: 'create',
      entity_schema: 'clinical',
      entity_table: 'encounter',
      entity_pk: created.encounterId,
      ambulatorio_id: parsed.data.ambulatorio_id,
      patient_id: parsed.data.patient_id,
      correlation_id: request.id,
      after_data: parsed.data
    });

    return reply.code(201).send(created);
  });

  fastify.get('/encounters/:id/revisions', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('encounters.read')]
  }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid params', details: params.error.issues });
    }

    const rows = await getEncounterRevisions(params.data.id);
    return reply.send(rows);
  });

  fastify.post('/encounters/:id/revisions', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('encounters.write')]
  }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const body = revisionSchema.safeParse(request.body);

    if (!params.success || !body.success) {
      return reply.code(400).send({
        error: 'Invalid payload',
        details: {
          params: params.success ? [] : params.error.issues,
          body: body.success ? [] : body.error.issues
        }
      });
    }

    if (!request.auth?.userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const created = await createEncounterRevision({
      encounter_id: params.data.id,
      visit_at: body.data.visit_at,
      visit_type: body.data.visit_type,
      reason: body.data.reason,
      actor_user_id: request.auth.userId,
      clinical_data: body.data.clinical_data
    });

    await logAuditEvent({
      actor_user_id: request.auth.userId,
      action: 'create_revision',
      entity_schema: 'clinical',
      entity_table: 'encounter_revision',
      entity_pk: created.revisionId,
      correlation_id: request.id,
      after_data: body.data
    });

    return reply.code(201).send(created);
  });
};
