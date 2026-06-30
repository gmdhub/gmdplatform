import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { logAuditEvent } from '../../repos/audit-repo.js';
import {
  createAppointment,
  deleteAppointment,
  listAppointments,
  updateAppointment
} from '../../repos/appointments-repo.js';

const listQuerySchema = z.object({
  ambulatorio_id: z.coerce.number().int().positive().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().min(0).optional()
});

const createSchema = z.object({
  ambulatorio_id: z.number().int().positive(),
  patient_id: z.string().uuid(),
  start_at: z.string().min(1),
  end_at: z.string().min(1),
  duration_minutes: z.number().int().min(10),
  status: z.enum(['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']).default('scheduled'),
  reason: z.string().optional().nullable(),
  origin: z.enum(['manual', 'followup_visit']).default('manual'),
  source_encounter_revision_id: z.string().uuid().optional().nullable()
});

const patchSchema = createSchema.partial();
const idParams = z.object({ id: z.string().uuid() });

export const appointmentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/appointments', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('appointments.read')]
  }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query', details: parsed.error.issues });
    }

    const rows = await listAppointments({
      ambulatorioId: parsed.data.ambulatorio_id,
      from: parsed.data.from,
      to: parsed.data.to,
      limit: parsed.data.limit,
      offset: parsed.data.offset
    });

    return reply.send(rows);
  });

  fastify.post('/appointments', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('appointments.write')]
  }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });
    }

    const id = await createAppointment({
      ...parsed.data,
      actor_user_id: request.auth?.userId ?? null
    });

    await logAuditEvent({
      actor_user_id: request.auth?.userId ?? null,
      action: 'create',
      entity_schema: 'scheduling',
      entity_table: 'appointment',
      entity_pk: String(id ?? ''),
      ambulatorio_id: parsed.data.ambulatorio_id,
      patient_id: parsed.data.patient_id,
      correlation_id: request.id,
      after_data: parsed.data
    });

    return reply.code(201).send({ id });
  });

  fastify.patch('/appointments/:id', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('appointments.write')]
  }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const parsed = patchSchema.safeParse(request.body);

    if (!params.success || !parsed.success) {
      return reply.code(400).send({
        error: 'Invalid payload',
        details: {
          params: params.success ? [] : params.error.issues,
          body: parsed.success ? [] : parsed.error.issues
        }
      });
    }

    await updateAppointment(params.data.id, parsed.data, request.auth?.userId ?? undefined);

    await logAuditEvent({
      actor_user_id: request.auth?.userId ?? null,
      action: 'update',
      entity_schema: 'scheduling',
      entity_table: 'appointment',
      entity_pk: params.data.id,
      correlation_id: request.id,
      after_data: parsed.data
    });

    return reply.code(204).send();
  });

  fastify.delete('/appointments/:id', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('appointments.write')]
  }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid params', details: params.error.issues });
    }

    await deleteAppointment(params.data.id, request.auth?.userId ?? undefined);

    await logAuditEvent({
      actor_user_id: request.auth?.userId ?? null,
      action: 'soft_delete',
      entity_schema: 'scheduling',
      entity_table: 'appointment',
      entity_pk: params.data.id,
      correlation_id: request.id
    });

    return reply.code(204).send();
  });
};
