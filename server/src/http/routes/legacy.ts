import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { logAuditEvent } from '../../repos/audit-repo.js';
import {
  createLegacyAppointment,
  createLegacyVisitaCompleta,
  createLegacyVisitaVersioneCompleta,
  createLegacyVisita,
  deleteLegacyAppointment,
  deleteLegacyFattoreByVisitaId,
  deleteLegacyVisita,
  getLegacyAppointmentById,
  getLegacyAppointmentBySourceVisitaId,
  getLegacyFattoreByVisitaId,
  getLegacyVisitaById,
  listLegacyAppointments,
  listLegacyFattoriByVisitaIds,
  listLegacyVisite,
  updateLegacyAppointment,
  updateLegacyVisitaCompleta,
  updateLegacyFattore,
  updateLegacyVisita,
  upsertLegacyFattore
} from '../../repos/legacy-repo.js';

const numberIdParam = z.object({ id: z.coerce.number().int().positive() });
const numberVisitaParam = z.object({ visitaId: z.coerce.number().int().positive() });

const visitaCreateSchema = z.object({
  ambulatorio_id: z.number().int().positive(),
  paziente_id: z.number().int().positive(),
  medico_id: z.number().int().positive().optional(),
  previous_version_id: z.number().int().positive().nullable().optional(),
  is_current_version: z.number().int().optional(),
  data_visita: z.string().min(1),
  tipo_visita: z.string().min(1),
  motivo: z.string().min(1)
}).passthrough();

const visitaPatchSchema = z.record(z.string(), z.unknown());

const visitaCompletaWriteSchema = z.object({
  visita: z.record(z.string(), z.unknown()),
  fattoriRischioCV: z.record(z.string(), z.unknown())
});

const visitaVersioneCompletaWriteSchema = z.object({
  sourceVisitaId: z.number().int().positive(),
  visita: z.record(z.string(), z.unknown()),
  fattoriRischioCV: z.record(z.string(), z.unknown())
});

const visiteListQuerySchema = z.object({
  ambulatorio_id: z.coerce.number().int().positive().optional(),
  paziente_id: z.coerce.number().int().positive().optional(),
  search: z.string().optional(),
  current_only: z.union([z.coerce.number(), z.coerce.boolean()]).optional()
});

const fattoreCreateSchema = z.object({
  visita_id: z.number().int().positive(),
  familiarita: z.boolean().optional(),
  familiarita_note: z.string().optional(),
  ipertensione: z.boolean().optional(),
  diabete: z.boolean().optional(),
  diabete_durata: z.string().optional(),
  diabete_tipo: z.string().optional(),
  dislipidemia: z.boolean().optional(),
  obesita: z.boolean().optional(),
  fumo: z.string().optional(),
  fumo_ex_eta: z.string().optional()
}).passthrough();

const fattorePatchSchema = z.record(z.string(), z.unknown());

const fattoriListQuerySchema = z.object({
  visita_ids: z.string().optional()
});

const appuntamentoCreateSchema = z.object({
  ambulatorio_id: z.number().int().positive(),
  paziente_id: z.number().int().positive(),
  data_ora_inizio: z.string().min(1),
  data_ora_fine: z.string().min(1),
  durata_minuti: z.number().int().positive().optional(),
  motivo: z.string().optional().nullable(),
  origine: z.enum(['manuale', 'followup_visita']).optional(),
  source_visita_id: z.number().int().positive().nullable().optional()
}).passthrough();

const appuntamentoPatchSchema = z.record(z.string(), z.unknown());

const appuntamentiListQuerySchema = z.object({
  ambulatorio_id: z.coerce.number().int().positive().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  source_visita_id: z.coerce.number().int().positive().optional()
});

function parseCurrentOnly(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value === 1;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true';
  }

  return false;
}

export const legacyRoutes: FastifyPluginAsync = async (fastify) => {
  const encounterReadAuth = [fastify.requireAuth, fastify.requirePermission('encounters.read')];
  const encounterWriteAuth = [fastify.requireAuth, fastify.requirePermission('encounters.write')];
  const appointmentReadAuth = [fastify.requireAuth, fastify.requirePermission('appointments.read')];
  const appointmentWriteAuth = [fastify.requireAuth, fastify.requirePermission('appointments.write')];

  fastify.get('/legacy/visite', { preHandler: encounterReadAuth }, async (request, reply) => {
    const parsed = visiteListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query', details: parsed.error.issues });
    }

    const rows = await listLegacyVisite({
      ambulatorio_id: parsed.data.ambulatorio_id,
      paziente_id: parsed.data.paziente_id,
      search: parsed.data.search,
      current_only: parseCurrentOnly(parsed.data.current_only)
    });

    return reply.send(rows);
  });

  fastify.get('/legacy/visite/:id', { preHandler: encounterReadAuth }, async (request, reply) => {
    const params = numberIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid params', details: params.error.issues });
    }

    const row = await getLegacyVisitaById(params.data.id);
    if (!row) {
      return reply.code(404).send({ error: 'Visita not found' });
    }

    return reply.send(row);
  });

  fastify.post('/legacy/visite', { preHandler: encounterWriteAuth }, async (request, reply) => {
    const body = visitaCreateSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: body.error.issues });
    }

    if (!request.auth?.userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const id = await createLegacyVisita(body.data as Record<string, unknown>, request.auth.userId);

    await logAuditEvent({
      actor_user_id: request.auth.userId,
      action: 'create',
      entity_schema: 'compat',
      entity_table: 'visite',
      entity_pk: String(id),
      ambulatorio_id: body.data.ambulatorio_id,
      correlation_id: request.id,
      after_data: body.data
    });

    return reply.code(201).send({ id });
  });

  fastify.patch('/legacy/visite/:id', { preHandler: encounterWriteAuth }, async (request, reply) => {
    const params = numberIdParam.safeParse(request.params);
    const body = visitaPatchSchema.safeParse(request.body);
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

    await updateLegacyVisita(params.data.id, body.data, request.auth.userId);

    await logAuditEvent({
      actor_user_id: request.auth.userId,
      action: 'update',
      entity_schema: 'compat',
      entity_table: 'visite',
      entity_pk: String(params.data.id),
      correlation_id: request.id,
      after_data: body.data
    });

    return reply.code(204).send();
  });

  fastify.delete('/legacy/visite/:id', { preHandler: encounterWriteAuth }, async (request, reply) => {
    const params = numberIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid params', details: params.error.issues });
    }

    await deleteLegacyVisita(params.data.id);

    await logAuditEvent({
      actor_user_id: request.auth?.userId ?? null,
      action: 'soft_delete',
      entity_schema: 'compat',
      entity_table: 'visite',
      entity_pk: String(params.data.id),
      correlation_id: request.id
    });

    return reply.code(204).send();
  });

  fastify.post('/legacy/visite-complete', { preHandler: encounterWriteAuth }, async (request, reply) => {
    const body = visitaCompletaWriteSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: body.error.issues });
    }

    if (!request.auth?.userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const id = await createLegacyVisitaCompleta(
      {
        visita: body.data.visita,
        fattoriRischioCV: body.data.fattoriRischioCV
      },
      request.auth.userId
    );

    await logAuditEvent({
      actor_user_id: request.auth.userId,
      action: 'create',
      entity_schema: 'compat',
      entity_table: 'visite_complete',
      entity_pk: String(id),
      correlation_id: request.id,
      after_data: body.data
    });

    return reply.code(201).send({ id });
  });

  fastify.patch('/legacy/visite-complete/:id', { preHandler: encounterWriteAuth }, async (request, reply) => {
    const params = numberIdParam.safeParse(request.params);
    const body = visitaCompletaWriteSchema.safeParse(request.body);
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

    await updateLegacyVisitaCompleta(
      {
        visitaId: params.data.id,
        visita: body.data.visita,
        fattoriRischioCV: body.data.fattoriRischioCV
      },
      request.auth.userId
    );

    await logAuditEvent({
      actor_user_id: request.auth.userId,
      action: 'update',
      entity_schema: 'compat',
      entity_table: 'visite_complete',
      entity_pk: String(params.data.id),
      correlation_id: request.id,
      after_data: body.data
    });

    return reply.code(204).send();
  });

  fastify.post('/legacy/visite-complete/version', { preHandler: encounterWriteAuth }, async (request, reply) => {
    const body = visitaVersioneCompletaWriteSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: body.error.issues });
    }

    if (!request.auth?.userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const id = await createLegacyVisitaVersioneCompleta(
      {
        sourceVisitaId: body.data.sourceVisitaId,
        visita: body.data.visita,
        fattoriRischioCV: body.data.fattoriRischioCV
      },
      request.auth.userId
    );

    await logAuditEvent({
      actor_user_id: request.auth.userId,
      action: 'create_revision',
      entity_schema: 'compat',
      entity_table: 'visite_complete',
      entity_pk: String(id),
      correlation_id: request.id,
      after_data: body.data
    });

    return reply.code(201).send({ id });
  });

  fastify.get('/legacy/fattori-rischio-cv', { preHandler: encounterReadAuth }, async (request, reply) => {
    const parsed = fattoriListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query', details: parsed.error.issues });
    }

    const ids = (parsed.data.visita_ids ?? '')
      .split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isInteger(value) && value > 0);

    const rows = await listLegacyFattoriByVisitaIds(ids);
    return reply.send(rows);
  });

  fastify.get('/legacy/fattori-rischio-cv/by-visita/:visitaId', { preHandler: encounterReadAuth }, async (request, reply) => {
    const params = numberVisitaParam.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid params', details: params.error.issues });
    }

    const row = await getLegacyFattoreByVisitaId(params.data.visitaId);
    if (!row) {
      return reply.code(404).send({ error: 'Fattore rischio not found' });
    }

    return reply.send(row);
  });

  fastify.post('/legacy/fattori-rischio-cv', { preHandler: encounterWriteAuth }, async (request, reply) => {
    const body = fattoreCreateSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: body.error.issues });
    }

    const id = await upsertLegacyFattore(body.data as Record<string, unknown>);

    await logAuditEvent({
      actor_user_id: request.auth?.userId ?? null,
      action: 'upsert',
      entity_schema: 'compat',
      entity_table: 'fattori_rischio_cv',
      entity_pk: String(id),
      correlation_id: request.id,
      after_data: body.data
    });

    return reply.code(201).send({ id });
  });

  fastify.patch('/legacy/fattori-rischio-cv/:id', { preHandler: encounterWriteAuth }, async (request, reply) => {
    const params = numberIdParam.safeParse(request.params);
    const body = fattorePatchSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({
        error: 'Invalid payload',
        details: {
          params: params.success ? [] : params.error.issues,
          body: body.success ? [] : body.error.issues
        }
      });
    }

    await updateLegacyFattore(params.data.id, body.data);

    await logAuditEvent({
      actor_user_id: request.auth?.userId ?? null,
      action: 'update',
      entity_schema: 'compat',
      entity_table: 'fattori_rischio_cv',
      entity_pk: String(params.data.id),
      correlation_id: request.id,
      after_data: body.data
    });

    return reply.code(204).send();
  });

  fastify.delete('/legacy/fattori-rischio-cv/:id', { preHandler: encounterWriteAuth }, async (request, reply) => {
    const params = numberIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid params', details: params.error.issues });
    }

    await deleteLegacyFattoreByVisitaId(params.data.id);
    return reply.code(204).send();
  });

  fastify.delete('/legacy/fattori-rischio-cv/by-visita/:visitaId', { preHandler: encounterWriteAuth }, async (request, reply) => {
    const params = numberVisitaParam.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid params', details: params.error.issues });
    }

    await deleteLegacyFattoreByVisitaId(params.data.visitaId);
    return reply.code(204).send();
  });

  fastify.get('/legacy/appuntamenti', { preHandler: appointmentReadAuth }, async (request, reply) => {
    const parsed = appuntamentiListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query', details: parsed.error.issues });
    }

    const rows = await listLegacyAppointments({
      ambulatorio_id: parsed.data.ambulatorio_id,
      from: parsed.data.from,
      to: parsed.data.to,
      source_visita_id: parsed.data.source_visita_id
    });

    return reply.send(rows);
  });

  fastify.get('/legacy/appuntamenti/:id', { preHandler: appointmentReadAuth }, async (request, reply) => {
    const params = numberIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid params', details: params.error.issues });
    }

    const row = await getLegacyAppointmentById(params.data.id);
    if (!row) {
      return reply.code(404).send({ error: 'Appuntamento not found' });
    }

    return reply.send(row);
  });

  fastify.get('/legacy/appuntamenti/by-source/:visitaId', { preHandler: appointmentReadAuth }, async (request, reply) => {
    const params = numberVisitaParam.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid params', details: params.error.issues });
    }

    const row = await getLegacyAppointmentBySourceVisitaId(params.data.visitaId);
    if (!row) {
      return reply.code(404).send({ error: 'Appuntamento not found' });
    }

    return reply.send(row);
  });

  fastify.post('/legacy/appuntamenti', { preHandler: appointmentWriteAuth }, async (request, reply) => {
    const body = appuntamentoCreateSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: body.error.issues });
    }

    if (!request.auth?.userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const id = await createLegacyAppointment(body.data as Record<string, unknown>, request.auth.userId);

    await logAuditEvent({
      actor_user_id: request.auth.userId,
      action: 'create',
      entity_schema: 'compat',
      entity_table: 'appuntamenti',
      entity_pk: String(id),
      ambulatorio_id: body.data.ambulatorio_id,
      correlation_id: request.id,
      after_data: body.data
    });

    return reply.code(201).send({ id });
  });

  fastify.patch('/legacy/appuntamenti/:id', { preHandler: appointmentWriteAuth }, async (request, reply) => {
    const params = numberIdParam.safeParse(request.params);
    const body = appuntamentoPatchSchema.safeParse(request.body);
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

    await updateLegacyAppointment(params.data.id, body.data, request.auth.userId);

    await logAuditEvent({
      actor_user_id: request.auth.userId,
      action: 'update',
      entity_schema: 'compat',
      entity_table: 'appuntamenti',
      entity_pk: String(params.data.id),
      correlation_id: request.id,
      after_data: body.data
    });

    return reply.code(204).send();
  });

  fastify.delete('/legacy/appuntamenti/:id', { preHandler: appointmentWriteAuth }, async (request, reply) => {
    const params = numberIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid params', details: params.error.issues });
    }

    if (!request.auth?.userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    await deleteLegacyAppointment(params.data.id, request.auth.userId);

    await logAuditEvent({
      actor_user_id: request.auth.userId,
      action: 'soft_delete',
      entity_schema: 'compat',
      entity_table: 'appuntamenti',
      entity_pk: String(params.data.id),
      correlation_id: request.id
    });

    return reply.code(204).send();
  });
};
