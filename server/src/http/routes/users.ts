import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { logAuditEvent } from '../../repos/audit-repo.js';
import {
  createUser,
  disableUserByLegacyId,
  listUsers,
  updateUserByLegacyId,
  updateUserPasswordByLegacyId,
  verifyUserPasswordByLegacyId
} from '../../repos/users-repo.js';

function ensureAdmin(request: { auth?: { roles?: string[] } }) {
  if (!request.auth?.roles?.includes('admin')) {
    const error = new Error('Forbidden');
    (error as Error & { statusCode?: number }).statusCode = 403;
    throw error;
  }
}

const createSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(['admin', 'medico', 'infermiere']),
  nome: z.string().min(1),
  cognome: z.string().min(1)
});

const patchSchema = z.object({
  username: z.string().min(1).optional(),
  role: z.enum(['admin', 'medico', 'infermiere']).optional(),
  nome: z.string().min(1).optional(),
  cognome: z.string().min(1).optional()
});

const verifyPasswordSchema = z.object({
  password: z.string().min(1)
});

const updatePasswordSchema = z.object({
  password: z.string().min(8)
});

const idParams = z.object({
  id: z.coerce.number().int().positive()
});

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/users', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('users.manage')]
  }, async (request, reply) => {
    ensureAdmin(request);
    const users = await listUsers();
    return reply.send(users);
  });

  fastify.post('/users', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('users.manage')]
  }, async (request, reply) => {
    ensureAdmin(request);

    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });
    }

    const userId = await createUser(parsed.data);

    await logAuditEvent({
      actor_user_id: request.auth?.userId ?? null,
      action: 'create',
      entity_schema: 'iam',
      entity_table: 'app_user',
      entity_pk: String(userId),
      correlation_id: request.id,
      after_data: {
        username: parsed.data.username,
        role: parsed.data.role,
        nome: parsed.data.nome,
        cognome: parsed.data.cognome
      }
    });

    return reply.code(201).send({ id: userId });
  });

  fastify.patch('/users/:id', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('users.manage')]
  }, async (request, reply) => {
    ensureAdmin(request);

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

    await updateUserByLegacyId(params.data.id, parsed.data);

    await logAuditEvent({
      actor_user_id: request.auth?.userId ?? null,
      action: 'update',
      entity_schema: 'iam',
      entity_table: 'app_user',
      entity_pk: String(params.data.id),
      correlation_id: request.id,
      after_data: parsed.data
    });

    return reply.code(204).send();
  });

  fastify.delete('/users/:id', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('users.manage')]
  }, async (request, reply) => {
    ensureAdmin(request);

    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid params', details: params.error.issues });
    }

    await disableUserByLegacyId(params.data.id);

    await logAuditEvent({
      actor_user_id: request.auth?.userId ?? null,
      action: 'disable',
      entity_schema: 'iam',
      entity_table: 'app_user',
      entity_pk: String(params.data.id),
      correlation_id: request.id
    });

    return reply.code(204).send();
  });

  fastify.post('/users/:id/verify-password', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('users.manage')]
  }, async (request, reply) => {
    ensureAdmin(request);

    const params = idParams.safeParse(request.params);
    const parsed = verifyPasswordSchema.safeParse(request.body);

    if (!params.success || !parsed.success) {
      return reply.code(400).send({
        error: 'Invalid payload',
        details: {
          params: params.success ? [] : params.error.issues,
          body: parsed.success ? [] : parsed.error.issues
        }
      });
    }

    const valid = await verifyUserPasswordByLegacyId(params.data.id, parsed.data.password);
    return reply.send({ valid });
  });

  fastify.post('/users/:id/password', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('users.manage')]
  }, async (request, reply) => {
    ensureAdmin(request);

    const params = idParams.safeParse(request.params);
    const parsed = updatePasswordSchema.safeParse(request.body);

    if (!params.success || !parsed.success) {
      return reply.code(400).send({
        error: 'Invalid payload',
        details: {
          params: params.success ? [] : params.error.issues,
          body: parsed.success ? [] : parsed.error.issues
        }
      });
    }

    await updateUserPasswordByLegacyId(params.data.id, parsed.data.password);

    await logAuditEvent({
      actor_user_id: request.auth?.userId ?? null,
      action: 'update_password',
      entity_schema: 'iam',
      entity_table: 'user_credential',
      entity_pk: String(params.data.id),
      correlation_id: request.id
    });

    return reply.code(204).send();
  });
};
