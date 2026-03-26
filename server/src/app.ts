import Fastify from 'fastify';
import cors from '@fastify/cors';
import { randomUUID } from 'node:crypto';
import { env } from './config/env.js';
import { authPlugin } from './http/middleware/auth.js';
import { registerRoutes } from './http/routes/index.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: 'info'
    },
    genReqId: () => randomUUID()
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['x-request-id']
  });

  await app.register(authPlugin);

  app.get('/health', async () => ({ ok: true, service: 'gmd-platform-api' }));

  await registerRoutes(app);

  app.setErrorHandler((error, request, reply) => {
    const maybeError = error as Error & { statusCode?: number };
    request.log.error(error);
    const statusCode =
      typeof maybeError.statusCode === 'number' && maybeError.statusCode >= 400
        ? maybeError.statusCode
        : 500;
    reply.code(statusCode).send({
      error: statusCode === 500 ? 'Internal server error' : maybeError.message,
      requestId: request.id
    });
  });

  return app;
}
