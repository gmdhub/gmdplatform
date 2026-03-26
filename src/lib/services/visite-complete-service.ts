import type {
  CreateFattoriRischioCVInput,
  CreateVisitaInput,
  UpdateFattoriRischioCVInput,
  UpdateVisitaInput
} from '$lib/db/types';
import { apiPatch, apiPost } from './http-client';

type VisitaCompletaPayload = {
  visita: Record<string, unknown>;
  fattoriRischioCV: Record<string, unknown>;
};

function sanitizeFattoriPayload(
  payload: Omit<CreateFattoriRischioCVInput, 'visita_id'> | Omit<UpdateFattoriRischioCVInput, 'id'>
): Record<string, unknown> {
  const { visita_id: _visitaId, id: _id, ...rest } = payload as Record<string, unknown>;
  return rest;
}

export async function createVisitaCompletaFromApi(input: {
  visita: CreateVisitaInput;
  fattoriRischioCV: Omit<CreateFattoriRischioCVInput, 'visita_id'>;
}): Promise<number> {
  const payload: VisitaCompletaPayload = {
    visita: input.visita as unknown as Record<string, unknown>,
    fattoriRischioCV: sanitizeFattoriPayload(input.fattoriRischioCV)
  };

  const response = await apiPost<{ id: number }>('/legacy/visite-complete', payload);
  return Number(response.id);
}

export async function updateVisitaCompletaFromApi(input: {
  visita: UpdateVisitaInput;
  fattoriRischioCV: Omit<UpdateFattoriRischioCVInput, 'id'>;
}): Promise<void> {
  const visitaId = Number(input.fattoriRischioCV.visita_id ?? input.visita.id ?? 0);
  if (!Number.isInteger(visitaId) || visitaId <= 0) {
    throw new Error('visita_id richiesto per aggiornare la visita completa');
  }

  const payload: VisitaCompletaPayload = {
    visita: input.visita as unknown as Record<string, unknown>,
    fattoriRischioCV: sanitizeFattoriPayload(input.fattoriRischioCV)
  };

  await apiPatch<void>(`/legacy/visite-complete/${visitaId}`, payload);
}

export async function createVisitaVersioneCompletaFromApi(input: {
  sourceVisitaId: number;
  visita: CreateVisitaInput;
  fattoriRischioCV: Omit<CreateFattoriRischioCVInput, 'visita_id'>;
}): Promise<number> {
  const response = await apiPost<{ id: number }>('/legacy/visite-complete/version', {
    sourceVisitaId: input.sourceVisitaId,
    visita: input.visita,
    fattoriRischioCV: sanitizeFattoriPayload(input.fattoriRischioCV)
  });

  return Number(response.id);
}
