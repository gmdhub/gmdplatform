import { createHash, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env.js';

const encoder = new TextEncoder();
const secret = encoder.encode(env.API_JWT_SECRET);

export type AccessTokenClaims = {
  sub: string;
  username: string;
  roles: string[];
  permissions: string[];
  scopeAmbulatori: number[];
  jti: string;
};

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export async function signAccessToken(claims: Omit<AccessTokenClaims, 'jti'>): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

export async function signRefreshToken(userId: string, sessionId: string): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${env.REFRESH_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

export async function verifyToken(token: string) {
  return jwtVerify(token, secret);
}
