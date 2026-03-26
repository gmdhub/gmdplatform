import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { logAuditEvent, logPatientAccess, logPatientAccessBatch } from '../../repos/audit-repo.js';
import {
  createPatient,
  deletePatientByLegacyId,
  getPatientByLegacyId,
  listPatients,
  updatePatientByLegacyId
} from '../../repos/patients-repo.js';

const querySchema = z.object({
  ambulatorio_id: z.coerce.number().int().positive().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().min(0).optional()
});

const createSchema = z.object({
  ambulatorio_id: z.number().int().positive(),
  nome: z.string().min(1),
  cognome: z.string().min(1),
  data_nascita: z.string().min(1),
  luogo_nascita: z.string().min(1),
  codice_fiscale: z.string().optional().nullable(),
  sesso: z.enum(['M', 'F', 'Altro']),
  esenzioni: z.string().optional().nullable(),
  indirizzo: z.string().optional().nullable(),
  citta: z.string().optional().nullable(),
  cap: z.string().optional().nullable(),
  provincia: z.string().optional().nullable(),
  telefono: z.string().optional().nullable(),
  email: z.string().optional().nullable()
});

const patchSchema = createSchema.partial();
const idParams = z.object({ id: z.coerce.number().int().positive() });

function normalizeTaxCode(value: string | null | undefined): { taxCode: string | null; temporaryCode: string | null } {
  const normalized = (value ?? '').trim();
  if (!normalized) {
    return { taxCode: null, temporaryCode: null };
  }

  if (normalized.toUpperCase().startsWith('TMP')) {
    return { taxCode: null, temporaryCode: normalized };
  }

  return { taxCode: normalized, temporaryCode: null };
}

export const patientRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/patients', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('patients.read')]
  }, async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query', details: parsed.error.issues });
    }

    const rows = await listPatients({
      ambulatorioId: parsed.data.ambulatorio_id,
      search: parsed.data.search,
      limit: parsed.data.limit,
      offset: parsed.data.offset
    });

    if (request.auth?.userId) {
      const items = rows
        .filter((row) => Boolean(row.internal_id))
        .map((row) => ({
          patient_id: String(row.internal_id)
        }));

      await logPatientAccessBatch({
        actor_user_id: request.auth.userId,
        access_type: 'view_patient',
        reason: 'patient_list_query',
        correlation_id: request.id,
        items
      });
    }

    return reply.send(rows);
  });

  fastify.get('/patients/:id', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('patients.read')]
  }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid params', details: params.error.issues });
    }

    const patient = await getPatientByLegacyId(params.data.id);
    if (!patient) {
      return reply.code(404).send({ error: 'Patient not found' });
    }

    if (request.auth?.userId) {
      if (!patient.internal_id) {
        return reply.code(500).send({ error: 'Patient internal id missing' });
      }

      await logPatientAccess({
        actor_user_id: request.auth.userId,
        patient_id: String(patient.internal_id),
        access_type: 'view_patient',
        reason: 'patient_detail',
        correlation_id: request.id
      });
    }

    return reply.send(patient);
  });

  fastify.post('/patients', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('patients.write')]
  }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });
    }

    const normalizedTax = normalizeTaxCode(parsed.data.codice_fiscale ?? null);

    const id = await createPatient({
      ambulatorio_id: parsed.data.ambulatorio_id,
      first_name: parsed.data.nome,
      last_name: parsed.data.cognome,
      birth_date: parsed.data.data_nascita,
      birth_place: parsed.data.luogo_nascita,
      sex: parsed.data.sesso,
      tax_code: normalizedTax.taxCode,
      temporary_code: normalizedTax.temporaryCode,
      exemptions: parsed.data.esenzioni ?? null,
      address: parsed.data.indirizzo ?? null,
      city: parsed.data.citta ?? null,
      cap: parsed.data.cap ?? null,
      province: parsed.data.provincia ?? null,
      phone: parsed.data.telefono ?? null,
      email: parsed.data.email ?? null,
      actor_user_id: request.auth?.userId ?? null
    });

    await logAuditEvent({
      actor_user_id: request.auth?.userId ?? null,
      action: 'create',
      entity_schema: 'patient',
      entity_table: 'patient',
      entity_pk: String(id ?? ''),
      ambulatorio_id: parsed.data.ambulatorio_id,
      correlation_id: request.id,
      after_data: parsed.data
    });

    return reply.code(201).send({ id });
  });

  fastify.patch('/patients/:id', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('patients.write')]
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

    const patchData: Record<string, unknown> = {};

    if (parsed.data.ambulatorio_id !== undefined) patchData.ambulatorio_id = parsed.data.ambulatorio_id;
    if (parsed.data.nome !== undefined) patchData.first_name = parsed.data.nome;
    if (parsed.data.cognome !== undefined) patchData.last_name = parsed.data.cognome;
    if (parsed.data.data_nascita !== undefined) patchData.birth_date = parsed.data.data_nascita;
    if (parsed.data.luogo_nascita !== undefined) patchData.birth_place = parsed.data.luogo_nascita;
    if (parsed.data.sesso !== undefined) patchData.sex = parsed.data.sesso;
    if (parsed.data.esenzioni !== undefined) patchData.exemptions = parsed.data.esenzioni;
    if (parsed.data.indirizzo !== undefined) patchData.address = parsed.data.indirizzo;
    if (parsed.data.citta !== undefined) patchData.city = parsed.data.citta;
    if (parsed.data.cap !== undefined) patchData.cap = parsed.data.cap;
    if (parsed.data.provincia !== undefined) patchData.province = parsed.data.provincia;
    if (parsed.data.telefono !== undefined) patchData.phone = parsed.data.telefono;
    if (parsed.data.email !== undefined) patchData.email = parsed.data.email;

    if (parsed.data.codice_fiscale !== undefined) {
      const normalizedTax = normalizeTaxCode(parsed.data.codice_fiscale ?? null);
      patchData.tax_code = normalizedTax.taxCode;
      patchData.temporary_code = normalizedTax.temporaryCode;
    }

    await updatePatientByLegacyId(params.data.id, patchData, request.auth?.userId ?? undefined);

    await logAuditEvent({
      actor_user_id: request.auth?.userId ?? null,
      action: 'update',
      entity_schema: 'patient',
      entity_table: 'patient',
      entity_pk: String(params.data.id),
      correlation_id: request.id,
      after_data: parsed.data
    });

    return reply.code(204).send();
  });

  fastify.delete('/patients/:id', {
    preHandler: [fastify.requireAuth, fastify.requirePermission('patients.write')]
  }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid params', details: params.error.issues });
    }

    await deletePatientByLegacyId(params.data.id, request.auth?.userId ?? null);

    await logAuditEvent({
      actor_user_id: request.auth?.userId ?? null,
      action: 'soft_delete',
      entity_schema: 'patient',
      entity_table: 'patient',
      entity_pk: String(params.data.id),
      correlation_id: request.id
    });

    return reply.code(204).send();
  });
};
