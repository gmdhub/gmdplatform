import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  loginWithPassword,
  logoutWithRefreshToken,
  refreshAuthTokens
} from '../../services/auth-service.js';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  deviceInfo: z.string().max(1024).optional()
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1)
});

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });
    }

    const ip = request.ip;
    const result = await loginWithPassword({
      username: parsed.data.username,
      password: parsed.data.password,
      ipAddress: ip,
      deviceInfo: parsed.data.deviceInfo ?? null
    });

    if (!result) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    return reply.send(result);
  });

  fastify.post('/auth/refresh', async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });
    }

    const tokens = await refreshAuthTokens(parsed.data.refreshToken);
    if (!tokens) {
      return reply.code(401).send({ error: 'Invalid refresh token' });
    }

    return reply.send(tokens);
  });

  fastify.post('/auth/logout', async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });
    }

    await logoutWithRefreshToken(parsed.data.refreshToken);
    return reply.code(204).send();
  });
};
