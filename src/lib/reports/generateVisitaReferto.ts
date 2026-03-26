import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { mkdir, readFile, writeFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { join, resolveResource } from '@tauri-apps/api/path';
import { rischioCVOptions } from '$lib/configs/clinical-options';
import { getAmbulatorioById } from '$lib/db/ambulatori';
import { isApiDataProvider } from '$lib/db/config';
import { getVisitaById } from '$lib/db/visite';
import type {
  EsamiEmaticiValues,
  FHAssessment,
  FirmeVisita,
  Paziente,
  PianificazioneFollowUp,
  TerapiaIpolipemizzante,
  TitoloFirmaMedico,
  ValutazioneRischioCardiovascolare
} from '$lib/db/types';
import { createReportMetadata } from '$lib/services/report-service';
import { getReportBaseDirectory, sanitizeReportFolderName } from '$lib/utils/report-storage';

const REPORT_TITLE = 'AMBULATORIO CARDIOLOGICO DELLE DISLIPIDEMIE';
const TEMPLATE_URL = new URL('../templates/template_dislip.docx', import.meta.url).href;
const TEMPLATE_RESOURCE_NAME = 'template_dislip.docx';

type TitoloToken = TitoloFirmaMedico | '';

type ReportPlaceholderPair = {
  header: string;
  value: string;
};

type ReportSpecializzando = {
  nome: string;
  titolo: TitoloToken;
};

type ReportFormData = {
  data_visita: string;
  tipo_visita: string;
  motivo: string;
  altezza: string;
  peso: string;
  bmi: string;
};

type ReportFattoriRischio = {
  familiarita: boolean;
  familiarita_note: string;
  ipertensione: boolean;
  diabete: boolean;
  diabete_durata: string;
  diabete_tipo: '' | '1' | '2';
  dislipidemia: boolean;
  obesita: boolean;
  fumo: string;
  fumo_ex_eta: string;
};

export type GenerateVisitaRefertoInput = {
  paziente: Paziente;
  formData: ReportFormData;
  fattoriRischio: ReportFattoriRischio;
  fhAssessment: FHAssessment;
  anamnesiPatologicaRemota: string;
  terapiaIpolipemizzante: TerapiaIpolipemizzante;
  terapiaDomiciliare: string;
  esamiEmatici: EsamiEmaticiValues;
  valutazioneRischioCV: ValutazioneRischioCardiovascolare;
  conclusioni: string;
  pianificazioneFollowUp: PianificazioneFollowUp;
  firmeVisita: FirmeVisita;
  visitaId?: number;
};

export type GenerateVisitaRefertoResult = {
  saved: boolean;
  path?: string;
  pdfPath?: string;
};

const esamiTemplateOrder: Array<{
  key: keyof EsamiEmaticiValues;
  label: string;
  unit: string;
}> = [
  { key: 'hb', label: 'Hb', unit: 'g/dL' },
  { key: 'plt', label: 'PLT', unit: '/uL' },
  { key: 'creatinina', label: 'Creatinina', unit: 'mg/dL' },
  { key: 'egfr', label: 'eGFR', unit: 'mL/min' },
  { key: 'colesterolo_totale', label: 'Colesterolo totale', unit: 'mg/dL' },
  { key: 'hdl', label: 'HDL', unit: 'mg/dL' },
  { key: 'trigliceridi', label: 'Trigliceridi', unit: 'mg/dL' },
  { key: 'ldl_calcolato', label: 'LDL calcolato', unit: 'mg/dL' },
  { key: 'ldl_diretto', label: 'LDL diretto', unit: 'mg/dL' },
  { key: 'lipoproteina_a', label: 'Lipoproteina a', unit: 'mg/dL' },
  { key: 'emoglobina_glicata', label: 'Emoglobina glicata (HbA1c)', unit: '%' },
  { key: 'glicemia', label: 'Glicemia', unit: 'mg/dL' },
  { key: 'ast', label: 'AST', unit: 'U/L' },
  { key: 'alt', label: 'ALT', unit: 'U/L' },
  { key: 'bilirubina_totale', label: 'Bilirubina totale', unit: 'mg/dL' },
  { key: 'cpk', label: 'CPK', unit: 'U/L' }
];

function cleanupMarkdown(value: string): string {
  return value
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatDate(value: string): string {
  if (!value) {
    return '';
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(parsed);
  }

  return value;
}

function formatDateTime(value: string): string {
  if (!value) {
    return '';
  }

  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?)?$/
  );
  if (match) {
    const baseDate = `${match[3]}/${match[2]}/${match[1]}`;
    if (match[4] && match[5]) {
      return `${baseDate} ${match[4]}:${match[5]}`;
    }
    return baseDate;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(parsed);
  }

  return value;
}

function formatDoctorTitle(value: TitoloToken): string {
  if (value === 'dott.ssa') {
    return 'Dott.ssa';
  }

  if (value === 'dott') {
    return 'Dott.';
  }

  return '';
}

function sanitizeFileName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatVisitDateForFileName(value: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  const directMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (directMatch) {
    return `${directMatch[3]}.${directMatch[2]}.${directMatch[1]}`;
  }

  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    const day = String(parsed.getDate()).padStart(2, '0');
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const year = String(parsed.getFullYear());
    return `${day}.${month}.${year}`;
  }

  return '';
}

function buildConditionalPair(
  headerLabel: string,
  content: string
): ReportPlaceholderPair {
  const normalizedContent = content.trim();

  if (!normalizedContent) {
    return {
      header: '',
      value: ''
    };
  }

  return {
    header: headerLabel,
    value: normalizedContent
  };
}

function buildFattoriRischioList(
  fattoriRischio: ReportFattoriRischio,
  bmiValue: string
): string {
  const items: string[] = [];

  if (fattoriRischio.familiarita) {
    const note = fattoriRischio.familiarita_note.trim();
    items.push(note ? `Familiarità (${note})` : 'Familiarità');
  }

  if (fattoriRischio.ipertensione) {
    items.push('Ipertensione arteriosa');
  }

  if (fattoriRischio.diabete) {
    let label = 'Diabete mellito';
    if (fattoriRischio.diabete_tipo) {
      label += ` tipo ${fattoriRischio.diabete_tipo}`;
    }
    if (fattoriRischio.diabete_durata.trim()) {
      label += ` (${fattoriRischio.diabete_durata.trim()})`;
    }
    items.push(label);
  }

  if (fattoriRischio.dislipidemia) {
    items.push('Dislipidemia');
  }

  if (fattoriRischio.obesita) {
    const bmi = Number.parseFloat(bmiValue.replace(',', '.'));
    if (Number.isFinite(bmi)) {
      if (bmi < 30) {
        items.push('Sovrappeso');
      } else if (bmi < 35) {
        items.push('Obesità classe I');
      } else if (bmi < 40) {
        items.push('Obesità classe II');
      } else {
        items.push('Obesità classe III');
      }
    } else {
      items.push('Obesità');
    }
  }

  if (fattoriRischio.fumo === 'si') {
    items.push('Fumo attivo');
  } else if (fattoriRischio.fumo === 'ex') {
    const note = fattoriRischio.fumo_ex_eta.trim();
    items.push(note ? `Ex fumatore (fino a ${note})` : 'Ex fumatore');
  }

  return items.join(', ');
}

function buildTerapiaIpolipemizzanteList(terapia: TerapiaIpolipemizzante): string {
  const items: string[] = [];

  if (terapia.statine.enabled && terapia.statine.dose) {
    items.push(terapia.statine.dose.trim());
  }

  if (terapia.ezetimibe.enabled) {
    const mode = terapia.ezetimibe.modalita.trim();
    items.push(mode && mode !== 'Senza associazione' ? `Ezetimibe - ${mode}` : 'Ezetimibe');
  }

  if (terapia.fibrati.enabled && terapia.fibrati.dose) {
    items.push(terapia.fibrati.dose.trim());
  }

  if (terapia.omega3.enabled && terapia.omega3.dose) {
    items.push(`Omega 3 ${terapia.omega3.dose.trim()}`);
  }

  if (terapia.acido_bempedoico.enabled && terapia.acido_bempedoico.dose) {
    items.push(`Acido bempedoico ${terapia.acido_bempedoico.dose.trim()}`);
  }

  if (terapia.repatha.enabled && terapia.repatha.dose) {
    items.push(`Evolocumab ${terapia.repatha.dose.trim()}`);
  }

  if (terapia.praluent.enabled && terapia.praluent.dose) {
    items.push(`Alirocumab ${terapia.praluent.dose.trim()}`);
  }

  if (terapia.leqvio.enabled && terapia.leqvio.dose) {
    items.push(`Inclisiran ${terapia.leqvio.dose.trim()}`);
  }

  return items.join(', ');
}

function buildEsamiEmaticiList(esami: EsamiEmaticiValues): string {
  const items = esamiTemplateOrder
    .map((analyte) => {
      const value = String(esami[analyte.key] || '').trim();
      if (!value) {
        return '';
      }

      if (analyte.key === 'plt') {
        const numericValue = Number.parseFloat(value.replace(',', '.'));
        if (Number.isFinite(numericValue)) {
          const normalizedValue = String(Math.round(numericValue * 1000));
          return `${analyte.label} ${normalizedValue} ${analyte.unit}`;
        }
      }

      return `${analyte.label} ${value} ${analyte.unit}`;
    })
    .filter(Boolean);

  return items.length > 0 ? items.join(', ') : '';
}

function buildRischioLabel(rischio: ValutazioneRischioCardiovascolare['rischio']): string {
  const option = rischioCVOptions.find((entry) => entry.value === rischio);
  return option?.label || '';
}

function buildTargetLabel(valutazione: ValutazioneRischioCardiovascolare): string {
  if (valutazione.status === 'raggiunto') {
    return 'Colesterolo LDL: a target';
  }

  if (valutazione.status === 'non_raggiunto') {
    return 'Colesterolo LDL: NON a target';
  }

  if (valutazione.targetLdl !== null) {
    return `Target LDL < ${valutazione.targetLdl} mg/dL`;
  }

  return '';
}

function buildFhDiagnosisLabel(classification: FHAssessment['classification']): string {
  switch (classification) {
    case 'Definita':
      return 'diagnosi definita';
    case 'Probabile':
      return 'diagnosi probabile';
    case 'Possibile':
      return 'diagnosi possibile';
    case 'Improbabile':
    default:
      return 'diagnosi improbabile';
  }
}

function buildProssimaVisitaLabel(pianificazioneFollowUp: PianificazioneFollowUp): string {
  const formattedDate = pianificazioneFollowUp.dataOraProssimaVisita
    ? formatDateTime(pianificazioneFollowUp.dataOraProssimaVisita)
    : '';
  const motivo = cleanupMarkdown(pianificazioneFollowUp.motivoProssimaVisita);

  if (!formattedDate) {
    return '';
  }

  if (!motivo) {
    return formattedDate;
  }

  return `${formattedDate} - ${motivo}`;
}

function buildEsenzioneValue(rawValue: string | null | undefined): string {
  const normalized = (rawValue ?? '').trim();
  if (!normalized) {
    return '-';
  }

  const compact = normalized.toLowerCase();
  if (compact === 'nessuno' || compact === 'non esente' || compact === 'nessuna') {
    return '-';
  }

  return normalized;
}

function buildReportData(input: GenerateVisitaRefertoInput): Record<string, string> {
  const fattoriRischioList = buildFattoriRischioList(input.fattoriRischio, input.formData.bmi);
  const anamnesiPatologicaRemota = cleanupMarkdown(input.anamnesiPatologicaRemota);
  const terapiaIpolipemizzante = buildTerapiaIpolipemizzanteList(input.terapiaIpolipemizzante);
  const terapiaDomiciliare = cleanupMarkdown(input.terapiaDomiciliare);
  const hasFattoriRischio = fattoriRischioList.trim().length > 0;
  const hasAnamnesiPatologicaRemota = anamnesiPatologicaRemota.trim().length > 0;

  const fattoriPair =
    !hasFattoriRischio && !hasAnamnesiPatologicaRemota
      ? { header: 'Non precedenti anamnestici di rilievo.', value: '' }
      : buildConditionalPair('Fattori di rischio CV:', fattoriRischioList);

  const aprPair = buildConditionalPair('Anamnesi patologica remota:', anamnesiPatologicaRemota);
  const terapiaIpolipemizzantePair =
    terapiaIpolipemizzante.trim().length > 0
      ? buildConditionalPair('Terapia ipolipemizzante:', terapiaIpolipemizzante)
      : { header: 'terapia ipolipemizzante:', value: 'nessuna in atto.' };
  const terapiaDomiciliarePair = buildConditionalPair(
    'Restante terapia domiciliare:',
    terapiaDomiciliare
  );
  const hasFhAssessment = input.fhAssessment.enabled;
  const fhHeader = hasFhAssessment ? 'Ipercolesterolemia familiare:' : 'ipercolesterolemia familiare:';
  const fhScore = hasFhAssessment
    ? `Dutch Lipid Score ${input.fhAssessment.totalScore} - ${buildFhDiagnosisLabel(input.fhAssessment.classification)}`
    : 'non presente.';

  const cardiologoNome = input.firmeVisita.cardiologoNome.trim();
  const specializzandi: ReportSpecializzando[] = input.firmeVisita.mediciInFormazione
    .map((medico): ReportSpecializzando => {
      const nome = medico.nome.trim();
      const titolo: TitoloToken = nome ? medico.titolo : '';
      return { nome, titolo };
    })
    .filter((medico) => medico.nome)
    .slice(0, 3);

  return {
    titolo: REPORT_TITLE,
    data_visita: formatDate(input.formData.data_visita),
    nome: input.paziente.nome,
    cognome: input.paziente.cognome,
    nato_nata:
      input.paziente.sesso === 'F' ? 'Nata' : input.paziente.sesso === 'M' ? 'Nato' : 'Nato/a',
    comune_nascita: input.paziente.luogo_nascita,
    data_nascita: formatDate(input.paziente.data_nascita),
    codice_fiscale: input.paziente.codice_fiscale,
    esenzione: buildEsenzioneValue(input.paziente.esenzioni),
    telefono: input.paziente.telefono?.trim() || '',
    peso: input.formData.peso.trim() || '',
    altezza: input.formData.altezza.trim() || '',
    bmi: input.formData.bmi.trim() || '',
    tipo_visita: input.formData.tipo_visita,
    motivo_visita: cleanupMarkdown(input.formData.motivo),
    hfdrcv: fattoriPair.header,
    fdrcv: fattoriPair.value,
    hapr: aprPair.header,
    apr: aprPair.value,
    htpipo: terapiaIpolipemizzantePair.header,
    tpipo: terapiaIpolipemizzantePair.value,
    hresttp: terapiaDomiciliarePair.header,
    resttp: terapiaDomiciliarePair.value,
    ipercol: fhHeader,
    ipercol_score: fhScore,
    data_ee: input.esamiEmatici.data_ee ? formatDate(input.esamiEmatici.data_ee) : '',
    ee: buildEsamiEmaticiList(input.esamiEmatici),
    rcv: buildRischioLabel(input.valutazioneRischioCV.rischio),
    target: buildTargetLabel(input.valutazioneRischioCV),
    conclusioni: cleanupMarkdown(input.conclusioni),
    proxvisita: buildProssimaVisitaLabel(input.pianificazioneFollowUp),
    proxee: cleanupMarkdown(input.pianificazioneFollowUp.esamiEmaticiDaFare) || '',
    dottssa: cardiologoNome ? formatDoctorTitle(input.firmeVisita.cardiologoTitolo) : '',
    cardiologo: cardiologoNome,
    nome_cardiologo: cardiologoNome,
    dottssasp1: formatDoctorTitle(specializzandi[0]?.titolo || ''),
    specializzando1: specializzandi[0]?.nome || '',
    dottssasp2: formatDoctorTitle(specializzandi[1]?.titolo || ''),
    specializzando2: specializzandi[1]?.nome || '',
    dottssasp3: formatDoctorTitle(specializzandi[2]?.titolo || ''),
    specializzando3: specializzandi[2]?.nome || '',
    nome_specializzando1: specializzandi[0]?.nome || '',
    nome_specializzando2: specializzandi[1]?.nome || '',
    nome_specializzando3: specializzandi[2]?.nome || ''
  };
}

function buildSuggestedFileName(input: GenerateVisitaRefertoInput): string {
  const cognome = sanitizeFileName(input.paziente.cognome) || 'Paziente';
  const nome = sanitizeFileName(input.paziente.nome) || 'Sconosciuto';
  const dataVisita = formatVisitDateForFileName(input.formData.data_visita) || 'data_visita';

  return `${cognome} ${nome} ${dataVisita}.docx`;
}

function getDislipidemieTerapiaFolderName(terapia: TerapiaIpolipemizzante): string {
  if (terapia.repatha.enabled) {
    return 'Repatha';
  }

  if (terapia.praluent.enabled) {
    return 'Praluent';
  }

  if (terapia.leqvio.enabled) {
    return 'Leqvio';
  }

  return 'Altro';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error && typeof error === 'object') {
    const maybeMessage = 'message' in error ? (error as { message?: unknown }).message : undefined;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') {
        return serialized;
      }
    } catch {
      // ignore JSON serialization failures
    }
  }

  return 'Errore sconosciuto';
}

async function loadTemplateFromAsset(): Promise<ArrayBuffer> {
  const response = await fetch(TEMPLATE_URL);

  if (!response.ok) {
    throw new Error('Template DOCX non trovato');
  }

  return response.arrayBuffer();
}

async function loadTemplateFromResource(): Promise<ArrayBuffer> {
  const resourcePath = await resolveResource(TEMPLATE_RESOURCE_NAME);
  const content = await readFile(resourcePath);
  return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
}

async function loadTemplate(): Promise<ArrayBuffer> {
  try {
    return await loadTemplateFromAsset();
  } catch (assetError) {
    try {
      return await loadTemplateFromResource();
    } catch (resourceError) {
      throw new Error(
        `Template DOCX non disponibile. Asset web: ${getErrorMessage(assetError)}. Risorsa Tauri: ${getErrorMessage(resourceError)}`
      );
    }
  }
}

function renderTemplate(template: ArrayBuffer, data: Record<string, string>): Uint8Array {
  const zip = new PizZip(template);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => ''
  });

  doc.render(data);

  return doc.getZip().generate({
    type: 'uint8array'
  });
}

function ensureDocxExtension(filePath: string): string {
  return filePath.toLowerCase().endsWith('.docx') ? filePath : `${filePath}.docx`;
}

function buildHiddenPdfPathFromDocx(docxPath: string): string {
  const separatorIndex = Math.max(docxPath.lastIndexOf('/'), docxPath.lastIndexOf('\\'));
  const directory = separatorIndex >= 0 ? docxPath.slice(0, separatorIndex + 1) : '';
  const fileName = separatorIndex >= 0 ? docxPath.slice(separatorIndex + 1) : docxPath;
  const pdfFileName = fileName.replace(/\.docx$/i, '.pdf');
  const hiddenPdfFileName = pdfFileName.startsWith('.') ? pdfFileName : `.${pdfFileName}`;
  return `${directory}${hiddenPdfFileName}`;
}

async function computeSha256Hex(content: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', content);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function resolveAmbulatorioDirectory(input: GenerateVisitaRefertoInput): Promise<string> {
  const baseDirectory = await getReportBaseDirectory();
  const ambulatorio = await getAmbulatorioById(input.paziente.ambulatorio_id);
  const ambulatorioNome = sanitizeReportFolderName(
    ambulatorio?.nome || `Ambulatorio ${input.paziente.ambulatorio_id}`
  );

  let outputDirectory = await join(baseDirectory, ambulatorioNome);

  if (ambulatorio?.nome === 'Ambulatorio Cardiologico delle Dislipidemie') {
    outputDirectory = await join(
      outputDirectory,
      getDislipidemieTerapiaFolderName(input.terapiaIpolipemizzante)
    );
  }

  await mkdir(outputDirectory, { recursive: true });
  return outputDirectory;
}

async function resolveOutputPath(input: GenerateVisitaRefertoInput): Promise<string> {
  const outputDirectory = await resolveAmbulatorioDirectory(input);
  const filePath = await join(outputDirectory, buildSuggestedFileName(input));
  return ensureDocxExtension(filePath);
}

export async function resolveVisitaRefertoOutputPaths(
  input: GenerateVisitaRefertoInput
): Promise<{ docxPath: string; pdfPath: string }> {
  const docxPath = await resolveOutputPath(input);
  const pdfPath = buildHiddenPdfPathFromDocx(docxPath);
  return { docxPath, pdfPath };
}

export async function buildVisitaRefertoDocxContent(
  input: GenerateVisitaRefertoInput
): Promise<Uint8Array> {
  const template = await loadTemplate();
  return renderTemplate(template, buildReportData(input));
}

export async function generateVisitaReferto(
  input: GenerateVisitaRefertoInput
): Promise<GenerateVisitaRefertoResult> {
  const content = await buildVisitaRefertoDocxContent(input);
  const resolvedPath = await resolveOutputPath(input);
  const hiddenPdfPath = buildHiddenPdfPathFromDocx(resolvedPath);

  await writeFile(resolvedPath, content, { create: true });

  let resolvedPdfPath: string | undefined;
  try {
    resolvedPdfPath = await invoke<string>('convert_docx_to_pdf', {
      docxPath: resolvedPath,
      outputPdfPath: hiddenPdfPath
    });
  } catch (errorWithOutputPath) {
    try {
      resolvedPdfPath = await invoke<string>('convert_docx_to_pdf', {
        docxPath: resolvedPath
      });
    } catch (errorLegacyMode) {
      console.warn(
        'Impossibile pre-generare il PDF referto:',
        `${getErrorMessage(errorWithOutputPath)} | fallback legacy: ${getErrorMessage(errorLegacyMode)}`
      );
    }
  }

  if (isApiDataProvider() && input.visitaId) {
    try {
      const visita = await getVisitaById(input.visitaId);
      if (visita?.internal_revision_id) {
        await createReportMetadata({
          encounter_revision_id: visita.internal_revision_id,
          template_code: 'template_dislip',
          template_name: 'Template Dislipidemie',
          template_version: 1,
          storage_uri: resolvedPath,
          file_sha256: await computeSha256Hex(content),
          file_size_bytes: content.byteLength,
          mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        });
      }
    } catch (error) {
      console.warn('Impossibile salvare metadata referto su API:', error);
    }
  }

  return {
    saved: true,
    path: resolvedPath,
    pdfPath: resolvedPdfPath
  };
}
