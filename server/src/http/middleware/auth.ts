import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken } from '../../services/auth-tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: {
      userId: string;
      username: string;
      roles: string[];
      permissions: string[];
      scopeAmbulatori: number[];
      tokenJti: string;
    };
  }

  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (permissionCode: string) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authPlugin = fp(async (fastify) => {
  fastify.decorate('requireAuth', async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Missing bearer token' });
      return;
    }

    const token = header.slice('Bearer '.length).trim();

    try {
      const result = await verifyToken(token);
      const payload = result.payload as {
        sub: string;
        username?: string;
        roles?: string[];
        permissions?: string[];
        scopeAmbulatori?: number[];
        jti?: string;
      };

      request.auth = {
        userId: payload.sub,
        username: payload.username ?? '',
        roles: Array.isArray(payload.roles) ? payload.roles : [],
        permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
        scopeAmbulatori: Array.isArray(payload.scopeAmbulatori) ? payload.scopeAmbulatori : [],
        tokenJti: payload.jti ?? ''
      };
    } catch {
      reply.code(401).send({ error: 'Invalid token' });
    }
  });

  fastify.decorate('requirePermission', (permissionCode: string) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.auth) {
        reply.code(401).send({ error: 'Unauthorized' });
        return;
      }

      if (!request.auth.permissions.includes(permissionCode)) {
        reply.code(403).send({ error: 'Forbidden' });
        return;
      }
    };
  });
});
