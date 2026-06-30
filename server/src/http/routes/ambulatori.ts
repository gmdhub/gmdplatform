import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  getAmbulatorioById,
  getOperatingWindows,
  listAmbulatori,
  replaceOperatingWindows,
  updateAmbulatorioDetails,
  upsertSettings
} from '../../repos/ambulatori-repo.js';
import { logAuditEvent } from '../../repos/audit-repo.js';

const idParams = z.object({ id: z.coerce.number().int().positive() });

const settingsSchema = z.object({
  min_visit_minutes: z.number().int().min(10),
  standard_visit_minutes: z.number().int().min(10),
  report_base_uri: z.string().nullable().optional(),
  timezone: z.string().min(1).default('Europe/Rome')
});

const windowsSchema = z.object({
  windows: z.array(
    z.object({
      weekday: z.number().int().min(1).max(7),
      start_time: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
      end_time: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
      max_patients_per_day: z.number().int().min(1)
    })
  )
});

const updateAmbulatorioSchema = z.object({
  nome: z.string().min(1).optional(),
  logo_path: z.string().nullable().optional(),
  color_primary: z.string().optional(),
  color_secondary: z.string().optional(),
  color_accent: z.string().optional()
});

export const ambulatoriRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/ambulatori', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('ambulatori.read')]
  }, async (_request, reply) => {
    const rows = await listAmbulatori();
    return reply.send(rows);
  });

  fastify.get('/ambulatori/:id', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('ambulatori.read')]
  }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid params', details: params.error.issues });
    }

    const row = await getAmbulatorioById(params.data.id);
    if (!row) {
      return reply.code(404).send({ error: 'Ambulatorio not found' });
    }

    const windows = await getOperatingWindows(params.data.id);
    return reply.send({ ...row, windows });
  });

  fastify.put('/ambulatori/:id', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('ambulatori.write')]
  }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const body = updateAmbulatorioSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({
        error: 'Invalid payload',
        details: {
          params: params.success ? [] : params.error.issues,
          body: body.success ? [] : body.error.issues
        }
      });
    }

    await updateAmbulatorioDetails({
      ambulatorioId: params.data.id,
      name: body.data.nome,
      logoPath: body.data.logo_path,
      colorPrimary: body.data.color_primary,
      colorSecondary: body.data.color_secondary,
      colorAccent: body.data.color_accent
    });

    await logAuditEvent({
      actor_user_id: request.auth?.userId ?? null,
      action: 'update',
      entity_schema: 'org',
      entity_table: 'ambulatorio',
      entity_pk: String(params.data.id),
      ambulatorio_id: params.data.id,
      after_data: body.data
    });

    return reply.code(204).send();
  });

  fastify.put('/ambulatori/:id/settings', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('ambulatori.write')]
  }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const body = settingsSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({
        error: 'Invalid payload',
        details: {
          params: params.success ? [] : params.error.issues,
          body: body.success ? [] : body.error.issues
        }
      });
    }

    await upsertSettings({
      ambulatorioId: params.data.id,
      minVisitMinutes: body.data.min_visit_minutes,
      standardVisitMinutes: body.data.standard_visit_minutes,
      reportBaseUri: body.data.report_base_uri ?? null,
      timezone: body.data.timezone
    });

    await logAuditEvent({
      actor_user_id: request.auth?.userId ?? null,
      action: 'update',
      entity_schema: 'org',
      entity_table: 'ambulatorio_settings',
      entity_pk: String(params.data.id),
      ambulatorio_id: params.data.id,
      after_data: body.data
    });

    return reply.code(204).send();
  });

  fastify.put('/ambulatori/:id/orari', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('ambulatori.write')]
  }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const body = windowsSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({
        error: 'Invalid payload',
        details: {
          params: params.success ? [] : params.error.issues,
          body: body.success ? [] : body.error.issues
        }
      });
    }

    await replaceOperatingWindows({
      ambulatorioId: params.data.id,
      windows: body.data.windows
    });

    await logAuditEvent({
      actor_user_id: request.auth?.userId ?? null,
      action: 'replace',
      entity_schema: 'org',
      entity_table: 'ambulatorio_operating_window',
      entity_pk: String(params.data.id),
      ambulatorio_id: params.data.id,
      after_data: body.data
    });

    return reply.code(204).send();
  });
};
