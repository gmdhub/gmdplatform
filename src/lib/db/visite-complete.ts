import type {
  AppuntamentoWriteOptions,
  CreateFattoriRischioCVInput,
  CreateVisitaInput,
  UpdateFattoriRischioCVInput,
  UpdateVisitaInput
} from './types';
import { isApiDataProvider } from './config';
import {
  createFattoriRischioCV,
  getFattoriRischioCVByVisitaId,
  updateFattoriRischioCV
} from './fattori-rischio-cv';
import {
  buildConfirmationRequiredErrorMessage,
  createFollowUpAppuntamentoFromVisita,
  deleteAppuntamento,
  getAppuntamentoBySourceVisitaId,
  parseFollowUpScheduling,
  previewAppuntamentoWrite,
  updateAppuntamentoSourceVisitaId
} from './appuntamenti';
import { createVisita, getVisitaById, updateVisita } from './visite';
import {
  getVisitaEditDeleteLockedMessage,
  getVisitaPreviousVersionLockedMessage,
  isVisitaWithinEditDeleteWindow
} from '../utils/visite-permissions';
import {
  createVisitaCompletaFromApi,
  createVisitaVersioneCompletaFromApi,
  updateVisitaCompletaFromApi
} from '$lib/services/visite-complete-service';

type FattoriRischioPayload = Partial<Omit<CreateFattoriRischioCVInput, 'visita_id'>>;

function hasMeaningfulFattoriRischioCV(input: FattoriRischioPayload): boolean {
  return (
    Boolean(input.familiarita) ||
    Boolean(input.ipertensione) ||
    Boolean(input.diabete) ||
    Boolean(input.dislipidemia) ||
    Boolean(input.obesita) ||
    Boolean(input.familiarita_note?.trim()) ||
    Boolean(input.diabete_durata?.trim()) ||
    Boolean(input.diabete_tipo?.trim()) ||
    Boolean(input.fumo?.trim()) ||
    Boolean(input.fumo_ex_eta?.trim())
  );
}

async function ensureFollowUpCanBeScheduled(params: {
  ambulatorioId: number;
  dataOraProssimaVisita: string;
  appointmentIdForUpdate?: number;
  options?: AppuntamentoWriteOptions;
}): Promise<void> {
  const preview = await previewAppuntamentoWrite({
    ambulatorioId: params.ambulatorioId,
    dataOraInizio: params.dataOraProssimaVisita,
    appointmentIdForUpdate: params.appointmentIdForUpdate,
    options: params.options
  });

  if (!preview.saved && preview.requirements) {
    throw new Error(buildConfirmationRequiredErrorMessage(preview.requirements));
  }
}

function normalizeFollowUpMotivo(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isSameFollowUpSchedule(
  left: { dataOraProssimaVisita: string; motivoProssimaVisita: string } | null,
  right: { dataOraProssimaVisita: string; motivoProssimaVisita: string } | null
): boolean {
  if (!left || !right) {
    return false;
  }

  return (
    left.dataOraProssimaVisita === right.dataOraProssimaVisita &&
    normalizeFollowUpMotivo(left.motivoProssimaVisita) === normalizeFollowUpMotivo(right.motivoProssimaVisita)
  );
}

export async function createVisitaCompleta(input: {
  visita: CreateVisitaInput;
  fattoriRischioCV: Omit<CreateFattoriRischioCVInput, 'visita_id'>;
  followUpWriteOptions?: AppuntamentoWriteOptions;
}): Promise<number> {
  if (isApiDataProvider()) {
    return createVisitaCompletaFromApi({
      visita: input.visita,
      fattoriRischioCV: input.fattoriRischioCV
    });
  }

  const followUpScheduling = parseFollowUpScheduling(input.visita.pianificazione_followup);
  if (followUpScheduling) {
    await ensureFollowUpCanBeScheduled({
      ambulatorioId: input.visita.ambulatorio_id,
      dataOraProssimaVisita: followUpScheduling.dataOraProssimaVisita,
      options: input.followUpWriteOptions
    });
  }

  const visitaId = await createVisita(input.visita);

  if (hasMeaningfulFattoriRischioCV(input.fattoriRischioCV)) {
    await createFattoriRischioCV({
      ...input.fattoriRischioCV,
      visita_id: visitaId
    });
  }

  if (followUpScheduling) {
    const followUpCreation = await createFollowUpAppuntamentoFromVisita({
      visitaId,
      ambulatorioId: input.visita.ambulatorio_id,
      pazienteId: input.visita.paziente_id,
      dataOraInizio: followUpScheduling.dataOraProssimaVisita,
      motivo: followUpScheduling.motivoProssimaVisita,
      options: input.followUpWriteOptions
    });

    if (!followUpCreation.saved && followUpCreation.requirements) {
      throw new Error(buildConfirmationRequiredErrorMessage(followUpCreation.requirements));
    }
  }

  return visitaId;
}

export async function updateVisitaCompleta(input: {
  visita: UpdateVisitaInput;
  fattoriRischioCV: Omit<UpdateFattoriRischioCVInput, 'id'>;
  followUpWriteOptions?: AppuntamentoWriteOptions;
}): Promise<void> {
  if (isApiDataProvider()) {
    await updateVisitaCompletaFromApi({
      visita: input.visita,
      fattoriRischioCV: input.fattoriRischioCV
    });
    return;
  }

  const visitaId = input.fattoriRischioCV.visita_id ?? input.visita.id;
  if (!visitaId) {
    throw new Error('visita_id richiesto per aggiornare i fattori di rischio');
  }

  let pendingFollowUpCreation:
    | {
        ambulatorioId: number;
        pazienteId: number;
        dataOraInizio: string;
        motivo: string;
        options?: AppuntamentoWriteOptions;
      }
    | null = null;

  const followUpScheduling = parseFollowUpScheduling(input.visita.pianificazione_followup);
  if (followUpScheduling) {
    const existingSourceAppointment = await getAppuntamentoBySourceVisitaId(visitaId);
    if (!existingSourceAppointment) {
      const visita = await getVisitaById(visitaId);
      if (!visita) {
        throw new Error(`Visita ${visitaId} non trovata per sincronizzare la prossima visita`);
      }

      const ambulatorioId = input.visita.ambulatorio_id ?? visita.ambulatorio_id;
      const pazienteId = input.visita.paziente_id ?? visita.paziente_id;

      await ensureFollowUpCanBeScheduled({
        ambulatorioId,
        dataOraProssimaVisita: followUpScheduling.dataOraProssimaVisita,
        options: input.followUpWriteOptions
      });

      pendingFollowUpCreation = {
        ambulatorioId,
        pazienteId,
        dataOraInizio: followUpScheduling.dataOraProssimaVisita,
        motivo: followUpScheduling.motivoProssimaVisita,
        options: input.followUpWriteOptions
      };
    }
  }

  await updateVisita(input.visita);

  const hasMeaningfulData = hasMeaningfulFattoriRischioCV(input.fattoriRischioCV);
  const existingRecord = await getFattoriRischioCVByVisitaId(visitaId);

  if (existingRecord) {
    await updateFattoriRischioCV({
      id: existingRecord.id,
      ...input.fattoriRischioCV,
      visita_id: visitaId
    });
  } else if (hasMeaningfulData) {
    await createFattoriRischioCV({
      visita_id: visitaId,
      familiarita: Boolean(input.fattoriRischioCV.familiarita),
      familiarita_note: input.fattoriRischioCV.familiarita_note,
      ipertensione: Boolean(input.fattoriRischioCV.ipertensione),
      diabete: Boolean(input.fattoriRischioCV.diabete),
      diabete_durata: input.fattoriRischioCV.diabete_durata,
      diabete_tipo: input.fattoriRischioCV.diabete_tipo,
      dislipidemia: Boolean(input.fattoriRischioCV.dislipidemia),
      obesita: Boolean(input.fattoriRischioCV.obesita),
      fumo: input.fattoriRischioCV.fumo || '',
      fumo_ex_eta: input.fattoriRischioCV.fumo_ex_eta
    });
  }

  if (!pendingFollowUpCreation) {
    return;
  }

  const followUpCreation = await createFollowUpAppuntamentoFromVisita({
    visitaId,
    ambulatorioId: pendingFollowUpCreation.ambulatorioId,
    pazienteId: pendingFollowUpCreation.pazienteId,
    dataOraInizio: pendingFollowUpCreation.dataOraInizio,
    motivo: pendingFollowUpCreation.motivo,
    options: pendingFollowUpCreation.options
  });

  if (!followUpCreation.saved && followUpCreation.requirements) {
    throw new Error(buildConfirmationRequiredErrorMessage(followUpCreation.requirements));
  }
}

export async function createVisitaVersioneCompleta(input: {
  sourceVisitaId: number;
  visita: CreateVisitaInput;
  fattoriRischioCV: Omit<CreateFattoriRischioCVInput, 'visita_id'>;
  followUpWriteOptions?: AppuntamentoWriteOptions;
}): Promise<number> {
  if (isApiDataProvider()) {
    return createVisitaVersioneCompletaFromApi({
      sourceVisitaId: input.sourceVisitaId,
      visita: input.visita,
      fattoriRischioCV: input.fattoriRischioCV
    });
  }

  const sourceVisita = await getVisitaById(input.sourceVisitaId);
  if (!sourceVisita) {
    throw new Error(`Visita ${input.sourceVisitaId} non trovata`);
  }

  if (sourceVisita.is_current_version === 0) {
    throw new Error(getVisitaPreviousVersionLockedMessage());
  }

  if (!isVisitaWithinEditDeleteWindow(sourceVisita.data_visita)) {
    throw new Error(getVisitaEditDeleteLockedMessage());
  }

  const previousFollowUpScheduling = parseFollowUpScheduling(sourceVisita.pianificazione_followup);
  const nextFollowUpScheduling = parseFollowUpScheduling(input.visita.pianificazione_followup);
  const sameFollowUpScheduling = isSameFollowUpSchedule(previousFollowUpScheduling, nextFollowUpScheduling);
  const existingSourceAppointment = await getAppuntamentoBySourceVisitaId(sourceVisita.id);

  if (!sameFollowUpScheduling && nextFollowUpScheduling) {
    await ensureFollowUpCanBeScheduled({
      ambulatorioId: input.visita.ambulatorio_id,
      dataOraProssimaVisita: nextFollowUpScheduling.dataOraProssimaVisita,
      appointmentIdForUpdate: existingSourceAppointment?.id,
      options: input.followUpWriteOptions
    });
  } else if (sameFollowUpScheduling && nextFollowUpScheduling && !existingSourceAppointment) {
    await ensureFollowUpCanBeScheduled({
      ambulatorioId: input.visita.ambulatorio_id,
      dataOraProssimaVisita: nextFollowUpScheduling.dataOraProssimaVisita,
      options: input.followUpWriteOptions
    });
  }

  const newVisitaId = await createVisita({
    ...input.visita,
    previous_version_id: sourceVisita.id,
    is_current_version: 1
  });

  await updateVisita({
    id: sourceVisita.id,
    is_current_version: 0
  });

  if (hasMeaningfulFattoriRischioCV(input.fattoriRischioCV)) {
    await createFattoriRischioCV({
      ...input.fattoriRischioCV,
      visita_id: newVisitaId
    });
  }

  if (!nextFollowUpScheduling) {
    if (existingSourceAppointment) {
      await deleteAppuntamento(existingSourceAppointment.id);
    }

    return newVisitaId;
  }

  if (sameFollowUpScheduling) {
    if (existingSourceAppointment) {
      await updateAppuntamentoSourceVisitaId({
        appuntamentoId: existingSourceAppointment.id,
        sourceVisitaId: newVisitaId
      });
      return newVisitaId;
    }

    const followUpCreation = await createFollowUpAppuntamentoFromVisita({
      visitaId: newVisitaId,
      ambulatorioId: input.visita.ambulatorio_id,
      pazienteId: input.visita.paziente_id,
      dataOraInizio: nextFollowUpScheduling.dataOraProssimaVisita,
      motivo: nextFollowUpScheduling.motivoProssimaVisita,
      options: input.followUpWriteOptions
    });

    if (!followUpCreation.saved && followUpCreation.requirements) {
      throw new Error(buildConfirmationRequiredErrorMessage(followUpCreation.requirements));
    }

    return newVisitaId;
  }

  const followUpCreation = await createFollowUpAppuntamentoFromVisita({
    visitaId: newVisitaId,
    ambulatorioId: input.visita.ambulatorio_id,
    pazienteId: input.visita.paziente_id,
    dataOraInizio: nextFollowUpScheduling.dataOraProssimaVisita,
    motivo: nextFollowUpScheduling.motivoProssimaVisita,
    options: input.followUpWriteOptions
  });

  if (!followUpCreation.saved && followUpCreation.requirements) {
    throw new Error(buildConfirmationRequiredErrorMessage(followUpCreation.requirements));
  }

  if (existingSourceAppointment) {
    await deleteAppuntamento(existingSourceAppointment.id);
  }

  return newVisitaId;
}
