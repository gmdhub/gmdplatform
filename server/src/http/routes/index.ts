import type { FastifyInstance } from 'fastify';
import { ambulatoriRoutes } from './ambulatori.js';
import { appointmentRoutes } from './appointments.js';
import { authRoutes } from './auth.js';
import { encounterRoutes } from './encounters.js';
import { legacyRoutes } from './legacy.js';
import { patientRoutes } from './patients.js';
import { reportRoutes } from './reports.js';
import { userRoutes } from './users.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(ambulatoriRoutes);
  await app.register(patientRoutes);
  await app.register(legacyRoutes);
  await app.register(encounterRoutes);
  await app.register(appointmentRoutes);
  await app.register(reportRoutes);
}
