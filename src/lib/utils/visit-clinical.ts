import { bempedoicoDose, defaultFollowUpEsamiEmatici } from '$lib/configs/clinical-options';
import type {
  DoseSelection,
  EzetimibeSelection,
  EsamiEmaticiValues,
  FHAssessment,
  FirmeVisita,
  LDLSource,
  PianificazioneFollowUp,
  RischioCVLevel,
  RischioCVStatus,
  StatinaSelection,
  TerapiaIpolipemizzante,
  TitoloFirmaMedico,
  ValutazioneRischioCardiovascolare
} from '$lib/db/types';
import { calculateDutchLipidScore } from './dutch-lipid-score';

const emptyEsamiEmatici: EsamiEmaticiValues = {
  data_ee: '',
  hb: '',
  plt: '',
  creatinina: '',
  egfr: '',
  colesterolo_totale: '',
  hdl: '',
  trigliceridi: '',
  ldl_calcolato: '',
  ldl_diretto: '',
  lipoproteina_a: '',
  emoglobina_glicata: '',
  glicemia: '',
  ast: '',
  alt: '',
  bilirubina_totale: '',
  cpk: ''
};

// 2025 ESC focused update: the four general LDL-C goals remain unchanged vs 2019 ESC/EAS.
const rischioTargets: Record<Exclude<RischioCVLevel, ''>, number> = {
  basso: 116,
  moderato: 100,
  alto: 70,
  molto_alto: 55
};

export interface ClinicalSourceReference {
  id: string;
  shortLabel: string;
  citation: string;
  url: string;
  lastReviewed: string;
}

export type LdlTherapyFinalStatus = 'raggiunto' | 'non_raggiunto' | 'non_stimabile';

export type LdlCombinationClassKey = 'statin' | 'ezetimibe' | 'bempedoicAcid' | 'pcsk9i';

export interface LdlTherapyCombinationComponent {
  classKey: LdlCombinationClassKey;
  label: string;
  reductionPct: number;
  sourceIds: string[];
}

export interface LdlTherapyManualSelection {
  statinDose: string;
  ezetimibe: boolean;
  bempedoicAcid: boolean;
  pcsk9i: '' | InjectableKey;
}

export interface LdlRecommendationContext {
  selection: Partial<LdlTherapyManualSelection>;
  patientAge: number | null;
}

export interface LdlTherapyRecommendation {
  currentLdl: number;
  estimatedOriginalLdl: number | null;
  targetLdl: number;
  gapMgDl: number;
  riduzioneAddizionaleNecessariaPct: number;
  combinations: LdlTherapyRecommendationCombination[];
  selectedCombination: LdlTherapyRecommendationCombination | null;
  estimatedBestCombinationLdl: number | null;
  estimatedFinalLdl: number | null;
  finalStatus: LdlTherapyFinalStatus;
  warning: string | null;
  sourceIds: string[];
  sources: ClinicalSourceReference[];
}

export interface LdlTherapyRecommendationCombination {
  id: string;
  label: string;
  components: LdlTherapyCombinationComponent[];
  estimatedLdl: number;
  totalReductionPct: number;
  sourceIds: string[];
}

const sourceReviewDate = '2026-03-11';
const ezetimibeAdditionalReductionPct = 20;
const bempedoicWithStatinAdditionalReductionPct = 18;
const bempedoicMonotherapyReductionPct = 23;
const bempedoicWithEzetimibeTotalReductionPct = 38;
const maxPcsk9Age = 85;
const backgroundEvidenceSourceIds = [
  'CTT2010',
  'WANG2020',
  'DARWIN2020',
  'EUROASPIREV2019',
  'EFFECTUS2019',
  'DAVINCI2020',
  'POSTMIITALY2020',
  'KATZMANN2020'
];

type InjectableKey = 'repatha' | 'praluent' | 'leqvio';

interface StatinProfile {
  dose: string;
  reductionPct: number;
  sourceIds: string[];
}

const clinicalSourceRegistry: Record<string, ClinicalSourceReference> = {
  MODEL_RULES: {
    id: 'MODEL_RULES',
    shortLabel: 'Regole interne algoritmo',
    citation:
      'Regole computazionali interne GMD: stima LDL-C a combinazioni terapeutiche su LDL originale stimata (versione 2.0).',
    url: 'https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines',
    lastReviewed: sourceReviewDate
  },
  CTT2010: {
    id: 'CTT2010',
    shortLabel: 'CTT 2010',
    citation:
      'Baigent C, Blackwell L, Emberson J, et al. Lancet. 2010;376(9753):1670-1681. Efficacy and safety of more intensive lowering of LDL cholesterol.',
    url: 'https://doi.org/10.1016/S0140-6736(10)61350-5',
    lastReviewed: sourceReviewDate
  },
  WANG2020: {
    id: 'WANG2020',
    shortLabel: 'Wang 2020',
    citation:
      'Wang N, Fulcher J, Abeysuriya N, et al. Lancet Diabetes Endocrinol. 2020;8:36-49. Intensive LDL cholesterol-lowering treatment beyond current recommendations.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/?term=Wang+Fulcher+Intensive+LDL+cholesterol-lowering+treatment+beyond+current+recommendations',
    lastReviewed: sourceReviewDate
  },
  ESC2019: {
    id: 'ESC2019',
    shortLabel: 'ESC/EAS 2019',
    citation:
      'Mach F, Baigent C, Catapano AL, et al. 2019 ESC/EAS Guidelines for the management of dyslipidaemias. Eur Heart J. 2020;41:111-188.',
    url: 'https://doi.org/10.1093/eurheartj/ehz455',
    lastReviewed: sourceReviewDate
  },
  DARWIN2020: {
    id: 'DARWIN2020',
    shortLabel: 'DARWIN-T2D 2020',
    citation:
      'Morieri ML, Avogaro A, Fadini GP; DARWIN-T2D Network. Cardiovasc Diabetol. 2020;19(1):190.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/?term=Morieri+Avogaro+Fadini+Cardiovasc+Diabetol+2020+19+190',
    lastReviewed: sourceReviewDate
  },
  EUROASPIREV2019: {
    id: 'EUROASPIREV2019',
    shortLabel: 'EUROASPIRE V 2019',
    citation:
      'Kotseva K, De Backer G, De Bacquer D, et al. Eur J Prev Cardiol. 2019;26(8):824-835.',
    url: 'https://doi.org/10.1177/2047487318825350',
    lastReviewed: sourceReviewDate
  },
  EFFECTUS2019: {
    id: 'EFFECTUS2019',
    shortLabel: 'EFFECTUS 2019',
    citation:
      'Presta V, Figliuzzi I, Miceli F, et al. Atherosclerosis. 2019;285:40-48. Achievement of LDL targets in Italy.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/?term=Presta+Figliuzzi+Miceli+Atherosclerosis+2019+285+40-48',
    lastReviewed: sourceReviewDate
  },
  DAVINCI2020: {
    id: 'DAVINCI2020',
    shortLabel: 'DA VINCI 2020',
    citation:
      'Ray KK, Molemans B, Schoonen WM, et al. Eur J Prev Cardiol. 2020;zwaa047.',
    url: 'https://doi.org/10.1093/eurjpc/zwaa047',
    lastReviewed: sourceReviewDate
  },
  POSTMIITALY2020: {
    id: 'POSTMIITALY2020',
    shortLabel: 'Post-MI Italy 2020',
    citation:
      'Colivicchi F, Gulizia MM, Arca M, et al. Cardiovasc Ther. 2020;2020:3856242.',
    url: 'https://doi.org/10.1155/2020/3856242',
    lastReviewed: sourceReviewDate
  },
  KATZMANN2020: {
    id: 'KATZMANN2020',
    shortLabel: 'Katzmann 2020',
    citation:
      'Katzmann JL, Sorio-Vilela F, Dornstauder E, et al. Clin Res Cardiol. 2020. Non-statin lipid-lowering therapy over time.',
    url: 'https://doi.org/10.1007/s00392-020-01740-8',
    lastReviewed: sourceReviewDate
  },
  STELLAR2003: {
    id: 'STELLAR2003',
    shortLabel: 'STELLAR 2003',
    citation:
      'Jones PH, Davidson MH, Stein EA, et al. Am J Cardiol. 2003;92:152-160. Rosuvastatin vs atorvastatin/simvastatin/pravastatin across doses.',
    url: 'https://doi.org/10.1016/S0002-9149(03)00530-7',
    lastReviewed: sourceReviewDate
  },
  ESC2025: {
    id: 'ESC2025',
    shortLabel: 'ESC Focused Update 2025',
    citation:
      'Bytyci I, Siller-Matula J, et al. 2025 ESC focused update on management of dyslipidaemias.',
    url: 'https://doi.org/10.1093/eurheartj/ehaf190',
    lastReviewed: sourceReviewDate
  },
  EMA_NILEMDO: {
    id: 'EMA_NILEMDO',
    shortLabel: 'EMA Nilemdo EPAR',
    citation: 'European Medicines Agency. Nilemdo (bempedoic acid) EPAR.',
    url: 'https://www.ema.europa.eu/en/medicines/human/EPAR/nilemdo',
    lastReviewed: sourceReviewDate
  },
  EMA_NUSTENDI: {
    id: 'EMA_NUSTENDI',
    shortLabel: 'EMA Nustendi EPAR',
    citation: 'European Medicines Agency. Nustendi (bempedoic acid + ezetimibe) EPAR.',
    url: 'https://www.ema.europa.eu/en/medicines/human/EPAR/nustendi',
    lastReviewed: sourceReviewDate
  },
  EMA_PRALUENT: {
    id: 'EMA_PRALUENT',
    shortLabel: 'EMA Praluent EPAR',
    citation: 'European Medicines Agency. Praluent (alirocumab) EPAR.',
    url: 'https://www.ema.europa.eu/en/medicines/human/EPAR/praluent',
    lastReviewed: sourceReviewDate
  },
  EMA_REPATHA: {
    id: 'EMA_REPATHA',
    shortLabel: 'EMA Repatha EPAR',
    citation: 'European Medicines Agency. Repatha (evolocumab) EPAR.',
    url: 'https://www.ema.europa.eu/en/medicines/human/EPAR/repatha',
    lastReviewed: sourceReviewDate
  },
  EMA_LEQVIO: {
    id: 'EMA_LEQVIO',
    shortLabel: 'EMA Leqvio EPAR',
    citation: 'European Medicines Agency. Leqvio (inclisiran) EPAR.',
    url: 'https://www.ema.europa.eu/en/medicines/human/EPAR/leqvio',
    lastReviewed: sourceReviewDate
  }
};

const statinDoseReductionTypical: Record<string, { reductionPct: number; sourceIds: string[] }> = {
  'Atorvastatina 10 mg': { reductionPct: 37, sourceIds: ['STELLAR2003'] },
  'Atorvastatina 20 mg': { reductionPct: 43, sourceIds: ['STELLAR2003'] },
  'Atorvastatina 40 mg': { reductionPct: 49, sourceIds: ['STELLAR2003'] },
  'Atorvastatina 80 mg': { reductionPct: 55, sourceIds: ['STELLAR2003'] },
  'Rosuvastatina 5 mg': { reductionPct: 40, sourceIds: ['ESC2019', 'MODEL_RULES'] },
  'Rosuvastatina 10 mg': { reductionPct: 46, sourceIds: ['STELLAR2003'] },
  'Rosuvastatina 20 mg': { reductionPct: 52, sourceIds: ['STELLAR2003'] },
  'Rosuvastatina 40 mg': { reductionPct: 55, sourceIds: ['STELLAR2003'] },
  'Simvastatina 10 mg': { reductionPct: 28, sourceIds: ['STELLAR2003'] },
  'Simvastatina 20 mg': { reductionPct: 35, sourceIds: ['STELLAR2003'] },
  'Simvastatina 40 mg': { reductionPct: 41, sourceIds: ['STELLAR2003'] },
  'Simvastatina 80 mg': { reductionPct: 47, sourceIds: ['STELLAR2003'] },
  'Pravastatina 10 mg': { reductionPct: 21, sourceIds: ['STELLAR2003'] },
  'Pravastatina 20 mg': { reductionPct: 24, sourceIds: ['STELLAR2003'] },
  'Pravastatina 40 mg': { reductionPct: 30, sourceIds: ['STELLAR2003'] },
  'Fluvastatina 20 mg': { reductionPct: 30, sourceIds: ['ESC2019', 'ESC2025', 'MODEL_RULES'] },
  'Fluvastatina 40 mg': { reductionPct: 30, sourceIds: ['ESC2019', 'ESC2025', 'MODEL_RULES'] },
  'Fluvastatina 80 mg': { reductionPct: 30, sourceIds: ['ESC2019', 'ESC2025', 'MODEL_RULES'] },
  'Pitavastatina 1 mg': { reductionPct: 30, sourceIds: ['ESC2019', 'ESC2025', 'MODEL_RULES'] },
  'Pitavastatina 2 mg': { reductionPct: 30, sourceIds: ['ESC2019', 'ESC2025', 'MODEL_RULES'] },
  'Pitavastatina 4 mg': { reductionPct: 30, sourceIds: ['ESC2019', 'ESC2025', 'MODEL_RULES'] }
};

const injectableProfiles: Record<
  InjectableKey,
  { label: string; additionalReductionPct: number; sourceIds: string[] }
> = {
  repatha: {
    label: 'Repatha (evolocumab)',
    additionalReductionPct: 57,
    sourceIds: ['ESC2025', 'EMA_REPATHA']
  },
  praluent: {
    label: 'Praluent (alirocumab)',
    additionalReductionPct: 55,
    sourceIds: ['ESC2025', 'EMA_PRALUENT']
  },
  leqvio: {
    label: 'Leqvio (inclisiran)',
    additionalReductionPct: 50,
    sourceIds: ['ESC2025', 'EMA_LEQVIO']
  }
};

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

export function createDefaultLdlTherapyManualSelection(): LdlTherapyManualSelection {
  return {
    statinDose: '',
    ezetimibe: false,
    bempedoicAcid: false,
    pcsk9i: ''
  };
}

function normalizeLdlTherapyManualSelection(
  input?: Partial<LdlTherapyManualSelection> | null
): LdlTherapyManualSelection {
  const merged = {
    ...createDefaultLdlTherapyManualSelection(),
    ...(input || {})
  };

  return {
    statinDose: typeof merged.statinDose === 'string' ? merged.statinDose.trim() : '',
    ezetimibe: Boolean(merged.ezetimibe),
    bempedoicAcid: Boolean(merged.bempedoicAcid),
    pcsk9i:
      merged.pcsk9i === 'repatha' || merged.pcsk9i === 'praluent' || merged.pcsk9i === 'leqvio'
        ? merged.pcsk9i
        : ''
  };
}

function roundToSingleDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function getStatinDoseReduction(dose: string): { reductionPct: number; sourceIds: string[] } | null {
  return statinDoseReductionTypical[dose] || null;
}

function getAllStatinProfiles(): StatinProfile[] {
  return Object.entries(statinDoseReductionTypical).map(([dose, profile]) => ({
    dose,
    reductionPct: profile.reductionPct,
    sourceIds: profile.sourceIds
  }));
}

function normalizePatientAge(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : null;
}

function toCombinationIdPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function applyReductionFactor(currentLdl: number, reductionPct: number): number {
  return currentLdl * (1 - reductionPct / 100);
}

function sortCombinations(
  combinations: LdlTherapyRecommendationCombination[]
): LdlTherapyRecommendationCombination[] {
  return [...combinations].sort((left, right) => {
    if (left.estimatedLdl !== right.estimatedLdl) {
      return left.estimatedLdl - right.estimatedLdl;
    }

    if (left.totalReductionPct !== right.totalReductionPct) {
      return right.totalReductionPct - left.totalReductionPct;
    }

    return left.label.localeCompare(right.label, 'it');
  });
}

function getActiveInjectables(terapia: TerapiaIpolipemizzante): InjectableKey[] {
  const active: InjectableKey[] = [];
  if (terapia.repatha.enabled) active.push('repatha');
  if (terapia.praluent.enabled) active.push('praluent');
  if (terapia.leqvio.enabled) active.push('leqvio');
  return active;
}

function resolveClinicalSources(sourceIds: string[]): ClinicalSourceReference[] {
  return uniqueStrings(sourceIds)
    .map((id) => clinicalSourceRegistry[id])
    .filter((source): source is ClinicalSourceReference => Boolean(source));
}

function getBempedoicAdditionalReduction(
  hasStatin: boolean,
  hasEzetimibe: boolean
): { reductionPct: number; sourceIds: string[] } {
  if (hasStatin) {
    return {
      reductionPct: bempedoicWithStatinAdditionalReductionPct,
      sourceIds: ['ESC2025', 'EMA_NILEMDO']
    };
  }

  if (hasEzetimibe) {
    const additionalReductionPct = roundToSingleDecimal(
      ((1 - bempedoicWithEzetimibeTotalReductionPct / 100) /
        (1 - ezetimibeAdditionalReductionPct / 100) -
        1) *
        -100
    );
    return {
      reductionPct: additionalReductionPct,
      sourceIds: ['ESC2025', 'EMA_NUSTENDI', 'MODEL_RULES']
    };
  }

  return {
    reductionPct: bempedoicMonotherapyReductionPct,
    sourceIds: ['ESC2025', 'EMA_NILEMDO']
  };
}

interface ModeledReduction {
  residualFactor: number;
  sourceIds: string[];
}

function buildCurrentTherapyReduction(
  terapia: TerapiaIpolipemizzante
): { modeled: ModeledReduction; warning: string | null } {
  let residualFactor = 1;
  const sourceIds: string[] = ['MODEL_RULES'];
  const warningParts: string[] = [];

  if (terapia.statine.enabled && terapia.statine.dose.trim().length > 0) {
    const statinProfile = getStatinDoseReduction(terapia.statine.dose.trim());
    if (statinProfile) {
      residualFactor *= 1 - statinProfile.reductionPct / 100;
      sourceIds.push(...statinProfile.sourceIds);
    } else {
      warningParts.push(
        "Dosaggio statina corrente non riconosciuto: la stima LDL originale non include l'effetto della statina."
      );
    }
  }

  if (terapia.ezetimibe.enabled) {
    residualFactor *= 1 - ezetimibeAdditionalReductionPct / 100;
    sourceIds.push('ESC2019', 'ESC2025');
  }

  if (terapia.acido_bempedoico.enabled) {
    const bempedoicProfile = getBempedoicAdditionalReduction(terapia.statine.enabled, terapia.ezetimibe.enabled);
    residualFactor *= 1 - bempedoicProfile.reductionPct / 100;
    sourceIds.push(...bempedoicProfile.sourceIds);
  }

  const activeInjectables = getActiveInjectables(terapia);
  if (activeInjectables.length === 1) {
    const injectableProfile = injectableProfiles[activeInjectables[0]];
    residualFactor *= 1 - injectableProfile.additionalReductionPct / 100;
    sourceIds.push(...injectableProfile.sourceIds);
  }

  return {
    modeled: {
      residualFactor,
      sourceIds: uniqueStrings(sourceIds)
    },
    warning: warningParts.length > 0 ? warningParts.join(' ') : null
  };
}

function estimateOriginalLdlFromCurrent(currentLdl: number, residualFactor: number): number | null {
  if (!Number.isFinite(residualFactor) || residualFactor <= 0) {
    return null;
  }

  return roundToSingleDecimal(Math.max(currentLdl / residualFactor, 0));
}

function createEmptyDoseSelection(): DoseSelection {
  return {
    enabled: false,
    dose: ''
  };
}

function createEmptyStatinaSelection(): StatinaSelection {
  return {
    enabled: false,
    dose: ''
  };
}

function createEmptyEzetimibeSelection(): EzetimibeSelection {
  return {
    enabled: false,
    modalita: ''
  };
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  const normalized = String(value).replace(',', '.').trim();
  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveCurrentLdl(
  esami: EsamiEmaticiValues
): { value: number | null; source: LDLSource } {
  const ldlDiretto = toNullableNumber(esami.ldl_diretto);
  if (ldlDiretto !== null) {
    return {
      value: ldlDiretto,
      source: 'diretto'
    };
  }

  const ldlCalcolato = toNullableNumber(esami.ldl_calcolato);
  if (ldlCalcolato !== null) {
    return {
      value: ldlCalcolato,
      source: 'calcolato'
    };
  }

  return {
    value: null,
    source: ''
  };
}

export function createEmptyEsamiEmatici(): EsamiEmaticiValues {
  return {
    ...emptyEsamiEmatici
  };
}

export function normalizeEsamiEmatici(input?: Partial<EsamiEmaticiValues> | null): EsamiEmaticiValues {
  const merged = {
    ...emptyEsamiEmatici,
    ...(input || {})
  };

  const normalized = createEmptyEsamiEmatici();
  for (const key of Object.keys(emptyEsamiEmatici) as Array<keyof EsamiEmaticiValues>) {
    const value = merged[key];
    normalized[key] = typeof value === 'string' ? value : value == null ? '' : String(value);
  }

  return normalized;
}

export function parseEsamiEmatici(raw?: string | null): EsamiEmaticiValues {
  if (!raw) return createEmptyEsamiEmatici();

  try {
    return normalizeEsamiEmatici(JSON.parse(raw) as Partial<EsamiEmaticiValues>);
  } catch {
    return createEmptyEsamiEmatici();
  }
}

export function serializeEsamiEmatici(data: EsamiEmaticiValues): string {
  return JSON.stringify(normalizeEsamiEmatici(data));
}

export function createEmptyValutazioneRischioCV(): ValutazioneRischioCardiovascolare {
  return {
    rischio: '',
    targetLdl: null,
    ldlAttuale: null,
    ldlSource: '',
    status: 'non_valutabile',
    statusMessage: 'Seleziona il rischio cardiovascolare'
  };
}

export function normalizeRischioCVLevel(value: unknown): RischioCVLevel {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  const compact = normalized.replace(/[\s-]+/g, '_');

  if (compact === 'basso') return 'basso';
  if (compact === 'moderato' || compact === 'medio') return 'moderato';
  if (compact === 'alto') return 'alto';
  if (compact === 'molto_alto' || compact === 'moltoalto' || compact === 'very_high') {
    return 'molto_alto';
  }

  return '';
}

function normalizeRischioCVStatus(value: unknown): RischioCVStatus | '' {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  const compact = normalized.replace(/[\s-]+/g, '_');

  if (compact === 'raggiunto' || compact === 'at_target' || compact === 'in_target') {
    return 'raggiunto';
  }

  if (
    compact === 'non_raggiunto' ||
    compact === 'not_at_target' ||
    compact === 'not_reached' ||
    compact === 'fuori_target'
  ) {
    return 'non_raggiunto';
  }

  if (compact === 'non_valutabile' || compact === 'not_evaluable' || compact === 'non_valutato') {
    return 'non_valutabile';
  }

  return '';
}

function normalizeLdlSource(value: unknown): LDLSource {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  if (normalized === 'diretto' || normalized === 'direct') return 'diretto';
  if (normalized === 'calcolato' || normalized === 'calculated') return 'calcolato';
  return '';
}

function normalizeTextValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeValutazioneRischioCV(
  input: Partial<ValutazioneRischioCardiovascolare> | null | undefined,
  esami: EsamiEmaticiValues
): ValutazioneRischioCardiovascolare {
  const rawInput = (input || {}) as Record<string, unknown>;
  const rischio: RischioCVLevel = normalizeRischioCVLevel(rawInput.rischio ?? rawInput.risk_level);
  const ldl = resolveCurrentLdl(normalizeEsamiEmatici(esami));

  if (!rischio) {
    return {
      rischio: '',
      targetLdl: null,
      ldlAttuale: ldl.value,
      ldlSource: ldl.source,
      status: 'non_valutabile',
      statusMessage: 'Seleziona il rischio cardiovascolare'
    };
  }

  const explicitTargetLdl = toNullableNumber(rawInput.targetLdl ?? rawInput.target_ldl);
  const explicitCurrentLdl = toNullableNumber(rawInput.ldlAttuale ?? rawInput.current_ldl);
  const explicitLdlSource = normalizeLdlSource(rawInput.ldlSource ?? rawInput.ldl_source);
  const explicitStatus = normalizeRischioCVStatus(rawInput.status);
  const explicitStatusMessage = normalizeTextValue(rawInput.statusMessage ?? rawInput.status_message);

  const targetLdl = explicitTargetLdl ?? rischioTargets[rischio];
  const currentLdl = explicitCurrentLdl ?? ldl.value;
  const ldlSource =
    explicitLdlSource || (currentLdl !== null && currentLdl === ldl.value ? ldl.source : '');

  let status: RischioCVStatus = 'non_valutabile';
  if (explicitStatus) {
    status = explicitStatus;
  } else if (currentLdl !== null && targetLdl !== null) {
    status = currentLdl < targetLdl ? 'raggiunto' : 'non_raggiunto';
  }

  const statusMessage =
    explicitStatusMessage ||
    (status === 'raggiunto'
      ? 'Target raggiunto'
      : status === 'non_raggiunto'
        ? 'Target non raggiunto'
        : 'Inserire LDL diretto o LDL calcolato');

  if (currentLdl === null) {
    return {
      rischio,
      targetLdl,
      ldlAttuale: null,
      ldlSource,
      status,
      statusMessage
    };
  }

  return {
    rischio,
    targetLdl,
    ldlAttuale: currentLdl,
    ldlSource,
    status,
    statusMessage
  };
}

export function parseValutazioneRischioCV(
  raw: string | null | undefined,
  esami: EsamiEmaticiValues
): ValutazioneRischioCardiovascolare {
  if (!raw) return normalizeValutazioneRischioCV(null, esami);

  try {
    return normalizeValutazioneRischioCV(
      JSON.parse(raw) as Partial<ValutazioneRischioCardiovascolare>,
      esami
    );
  } catch {
    return normalizeValutazioneRischioCV(null, esami);
  }
}

export function serializeValutazioneRischioCV(
  data: ValutazioneRischioCardiovascolare,
  esami: EsamiEmaticiValues
): string {
  return JSON.stringify(normalizeValutazioneRischioCV(data, esami));
}

export function isValutazioneRischioCVEqual(
  left: ValutazioneRischioCardiovascolare,
  right: ValutazioneRischioCardiovascolare
): boolean {
  return (
    left.rischio === right.rischio &&
    left.targetLdl === right.targetLdl &&
    left.ldlAttuale === right.ldlAttuale &&
    left.ldlSource === right.ldlSource &&
    left.status === right.status &&
    left.statusMessage === right.statusMessage
  );
}

export function buildLdlTherapyRecommendation(
  valutazioneInput: ValutazioneRischioCardiovascolare,
  terapiaInput: Partial<TerapiaIpolipemizzante>,
  contextInput: LdlRecommendationContext
): LdlTherapyRecommendation | null {
  if (import.meta.env.DEV && (!terapiaInput || typeof terapiaInput !== 'object')) {
    throw new Error(
      '[RISK-CV] buildLdlTherapyRecommendation richiede `terapiaInput`: verificare il wiring del chiamante.'
    );
  }
  if (import.meta.env.DEV && (!contextInput || typeof contextInput !== 'object')) {
    throw new Error(
      '[RISK-CV] buildLdlTherapyRecommendation richiede `contextInput` con selezione terapia ed eta paziente.'
    );
  }

  if (!terapiaInput || typeof terapiaInput !== 'object' || !contextInput || typeof contextInput !== 'object') {
    return null;
  }

  if (
    valutazioneInput.status !== 'non_raggiunto' ||
    valutazioneInput.ldlAttuale === null ||
    valutazioneInput.targetLdl === null ||
    valutazioneInput.ldlAttuale <= 0
  ) {
    return null;
  }

  const terapia = normalizeTerapiaIpolipemizzante(terapiaInput);
  const selection = normalizeLdlTherapyManualSelection(contextInput.selection);
  const patientAge = normalizePatientAge(contextInput.patientAge);
  const currentLdl = roundToSingleDecimal(valutazioneInput.ldlAttuale);
  const targetLdl = roundToSingleDecimal(valutazioneInput.targetLdl);
  const gapMgDl = roundToSingleDecimal(Math.max(currentLdl - targetLdl, 0));
  const riduzioneAddizionaleNecessariaPct = roundToSingleDecimal((gapMgDl / currentLdl) * 100);
  const activeInjectables = getActiveInjectables(terapia);

  if (activeInjectables.length > 1) {
    const sourceIds = uniqueStrings(['ESC2025', 'MODEL_RULES']);
    return {
      currentLdl,
      estimatedOriginalLdl: null,
      targetLdl,
      gapMgDl,
      riduzioneAddizionaleNecessariaPct,
      combinations: [],
      selectedCombination: null,
      estimatedBestCombinationLdl: null,
      estimatedFinalLdl: null,
      finalStatus: 'non_stimabile',
      warning:
        'Regime incoerente: sono selezionati contemporaneamente piu iniettabili (Praluent/Repatha/Leqvio). Correggere la terapia corrente per stimare LDL originale.',
      sourceIds,
      sources: resolveClinicalSources(sourceIds)
    };
  }

  const warningParts: string[] = [];
  const currentTherapyReduction = buildCurrentTherapyReduction(terapia);
  if (currentTherapyReduction.warning) {
    warningParts.push(currentTherapyReduction.warning);
  }

  const estimatedOriginalLdl = estimateOriginalLdlFromCurrent(
    currentLdl,
    currentTherapyReduction.modeled.residualFactor
  );

  if (estimatedOriginalLdl === null) {
    const sourceIds = uniqueStrings(['ESC2025', 'MODEL_RULES'].concat(currentTherapyReduction.modeled.sourceIds));
    return {
      currentLdl,
      estimatedOriginalLdl: null,
      targetLdl,
      gapMgDl,
      riduzioneAddizionaleNecessariaPct,
      combinations: [],
      selectedCombination: null,
      estimatedBestCombinationLdl: null,
      estimatedFinalLdl: null,
      finalStatus: 'non_stimabile',
      warning:
        'Impossibile stimare LDL originale dalla terapia corrente: verificare coerenza dei dati terapia.',
      sourceIds,
      sources: resolveClinicalSources(sourceIds)
    };
  }

  const components: LdlTherapyCombinationComponent[] = [];

  if (selection.statinDose) {
    const statinProfile = getStatinDoseReduction(selection.statinDose);
    if (statinProfile) {
      components.push({
        classKey: 'statin',
        label: selection.statinDose,
        reductionPct: statinProfile.reductionPct,
        sourceIds: uniqueStrings([...statinProfile.sourceIds, 'STELLAR2003'])
      });
    } else {
      warningParts.push(
        'Statina selezionata non riconosciuta nel modello: componente statina non applicata al calcolo.'
      );
    }
  }

  if (selection.ezetimibe) {
    components.push({
      classKey: 'ezetimibe',
      label: 'Ezetimibe 10 mg/die',
      reductionPct: ezetimibeAdditionalReductionPct,
      sourceIds: ['ESC2019', 'ESC2025']
    });
  }

  if (selection.bempedoicAcid) {
    const hasStatinInSelection = components.some((component) => component.classKey === 'statin');
    const bempedoicProfile = getBempedoicAdditionalReduction(hasStatinInSelection, selection.ezetimibe);
    components.push({
      classKey: 'bempedoicAcid',
      label: `Acido bempedoico ${bempedoicoDose}`,
      reductionPct: bempedoicProfile.reductionPct,
      sourceIds: uniqueStrings([...bempedoicProfile.sourceIds, 'ESC2025'])
    });
  }

  if (selection.pcsk9i) {
    const selectedPcsk9 = injectableProfiles[selection.pcsk9i];
    if (patientAge !== null && patientAge > maxPcsk9Age) {
      warningParts.push(
        `Eta paziente ${patientAge} anni: PCSK9i selezionato con warning informativo (> ${maxPcsk9Age} anni).`
      );
    }

    components.push({
      classKey: 'pcsk9i',
      label: selectedPcsk9.label,
      reductionPct: selectedPcsk9.additionalReductionPct,
      sourceIds: uniqueStrings([...selectedPcsk9.sourceIds, 'ESC2025'])
    });
  }

  if (components.length === 0) {
    const sourceIds = uniqueStrings(['ESC2025', 'MODEL_RULES'].concat(currentTherapyReduction.modeled.sourceIds));
    return {
      currentLdl,
      estimatedOriginalLdl,
      targetLdl,
      gapMgDl,
      riduzioneAddizionaleNecessariaPct,
      combinations: [],
      selectedCombination: null,
      estimatedBestCombinationLdl: null,
      estimatedFinalLdl: null,
      finalStatus: 'non_stimabile',
      warning: 'Seleziona almeno un principio attivo nelle liste a discesa per stimare il regime.',
      sourceIds,
      sources: resolveClinicalSources(sourceIds)
    };
  }

  let modeledLdlRaw = estimatedOriginalLdl;
  for (const component of components) {
    modeledLdlRaw = applyReductionFactor(modeledLdlRaw, component.reductionPct);
  }

  const estimatedLdl = roundToSingleDecimal(Math.max(modeledLdlRaw, 0));
  const totalReductionPct = roundToSingleDecimal(
    Math.max((1 - estimatedLdl / estimatedOriginalLdl) * 100, 0)
  );
  const combination: LdlTherapyRecommendationCombination = {
    id: components
      .map((component) => `${component.classKey}_${toCombinationIdPart(component.label)}`)
      .join('__'),
    label: components.map((component) => component.label).join(' + '),
    components,
    estimatedLdl,
    totalReductionPct,
    sourceIds: uniqueStrings(['MODEL_RULES', 'ESC2025'].concat(components.flatMap((c) => c.sourceIds)))
  };

  const finalStatus: LdlTherapyFinalStatus = estimatedLdl <= targetLdl ? 'raggiunto' : 'non_raggiunto';
  const warning = uniqueStrings(warningParts).join(' ').trim() || null;

  const sourceIds = uniqueStrings(
    backgroundEvidenceSourceIds.concat(currentTherapyReduction.modeled.sourceIds, combination.sourceIds)
  );

  return {
    currentLdl,
    estimatedOriginalLdl,
    targetLdl,
    gapMgDl,
    riduzioneAddizionaleNecessariaPct,
    combinations: [combination],
    selectedCombination: combination,
    estimatedBestCombinationLdl: combination.estimatedLdl,
    estimatedFinalLdl: combination.estimatedLdl,
    finalStatus,
    warning,
    sourceIds,
    sources: resolveClinicalSources(sourceIds)
  };
}

export function createEmptyPianificazioneFollowUp(): PianificazioneFollowUp {
  return {
    dataOraProssimaVisita: '',
    motivoProssimaVisita: '',
    esamiEmaticiDaFare: defaultFollowUpEsamiEmatici
  };
}

export function normalizePianificazioneFollowUp(
  input?: Partial<PianificazioneFollowUp> | null
): PianificazioneFollowUp {
  const hasEsamiEmaticiDaFare =
    input !== null &&
    input !== undefined &&
    Object.prototype.hasOwnProperty.call(input, 'esamiEmaticiDaFare');
  const rawEsamiEmaticiDaFare = typeof input?.esamiEmaticiDaFare === 'string'
    ? input.esamiEmaticiDaFare.trim()
    : undefined;

  return {
    dataOraProssimaVisita:
      typeof input?.dataOraProssimaVisita === 'string' ? input.dataOraProssimaVisita.trim() : '',
    motivoProssimaVisita:
      typeof input?.motivoProssimaVisita === 'string' ? input.motivoProssimaVisita.trim() : '',
    esamiEmaticiDaFare: hasEsamiEmaticiDaFare
      ? (rawEsamiEmaticiDaFare ?? '')
      : defaultFollowUpEsamiEmatici
  };
}

export function parsePianificazioneFollowUp(raw?: string | null): PianificazioneFollowUp {
  if (!raw) return createEmptyPianificazioneFollowUp();

  try {
    return normalizePianificazioneFollowUp(JSON.parse(raw) as Partial<PianificazioneFollowUp>);
  } catch {
    return createEmptyPianificazioneFollowUp();
  }
}

export function serializePianificazioneFollowUp(data: PianificazioneFollowUp): string {
  return JSON.stringify(normalizePianificazioneFollowUp(data));
}

export function createEmptyFirmeVisita(): FirmeVisita {
  return {
    cardiologoNome: '',
    cardiologoTitolo: 'dott',
    mediciInFormazione: [{ nome: '', titolo: 'dott' }]
  };
}

function normalizeTitoloFirma(value: unknown): TitoloFirmaMedico {
  return value === 'dott.ssa' ? 'dott.ssa' : 'dott';
}

export function normalizeFirmeVisita(input?: Partial<FirmeVisita> | null): FirmeVisita {
  const cardiologoNome = typeof input?.cardiologoNome === 'string' ? input.cardiologoNome.trim() : '';
  const cardiologoTitolo = normalizeTitoloFirma(input?.cardiologoTitolo);
  const rawMedici: unknown[] = Array.isArray(input?.mediciInFormazione)
    ? (input.mediciInFormazione as unknown[])
    : [];

  return {
    cardiologoNome,
    cardiologoTitolo,
    mediciInFormazione: rawMedici
      .map((value) => {
        if (typeof value === 'string') {
          return {
            nome: value.trim(),
            titolo: 'dott' as const
          };
        }

        if (value && typeof value === 'object') {
          const record = value as { nome?: unknown; titolo?: unknown };
          return {
            nome: typeof record.nome === 'string' ? record.nome.trim() : '',
            titolo: normalizeTitoloFirma(record.titolo)
          };
        }

        return {
          nome: '',
          titolo: 'dott' as const
        };
      })
      .filter((value) => value.nome.length > 0)
  };
}

export function parseFirmeVisita(raw?: string | null): FirmeVisita {
  if (!raw) return createEmptyFirmeVisita();

  try {
    const normalized = normalizeFirmeVisita(JSON.parse(raw) as Partial<FirmeVisita>);
    return {
      cardiologoNome: normalized.cardiologoNome,
      cardiologoTitolo: normalized.cardiologoTitolo,
      mediciInFormazione:
        normalized.mediciInFormazione.length > 0
          ? normalized.mediciInFormazione
          : [{ nome: '', titolo: 'dott' }]
    };
  } catch {
    return createEmptyFirmeVisita();
  }
}

export function serializeFirmeVisita(data: FirmeVisita): string {
  return JSON.stringify(normalizeFirmeVisita(data));
}

export function createEmptyFHAssessment(): FHAssessment {
  return {
    enabled: false,
    familyHistoryOnePoint: false,
    familyHistoryTwoPoints: false,
    clinicalPrematureCAD: false,
    clinicalPrematureCerebralOrPeripheral: false,
    physicalTendonXanthomas: false,
    physicalCornealArcusBefore45: false,
    untreatedLdlRange: '',
    geneticMutation: false,
    totalScore: 0,
    classification: 'Improbabile'
  };
}

export function normalizeFHAssessment(input?: Partial<FHAssessment> | null): FHAssessment {
  const base = createEmptyFHAssessment();
  const merged = {
    ...base,
    ...(input || {})
  };

  if (!merged.enabled) {
    return base;
  }

  const { total, classification } = calculateDutchLipidScore(merged);
  return {
    ...merged,
    totalScore: total,
    classification
  };
}

export function parseFHAssessment(raw?: string | null): FHAssessment {
  if (!raw) return createEmptyFHAssessment();

  try {
    return normalizeFHAssessment(JSON.parse(raw) as Partial<FHAssessment>);
  } catch {
    return createEmptyFHAssessment();
  }
}

export function serializeFHAssessment(data: FHAssessment): string {
  return JSON.stringify(normalizeFHAssessment(data));
}

export function validateFHAssessment(data: FHAssessment): string | null {
  const normalized = normalizeFHAssessment(data);

  if (normalized.enabled && !normalized.untreatedLdlRange) {
    return 'Nel profilo lipidico della FH devi selezionare una fascia LDL';
  }

  return null;
}

export function createEmptyTerapiaIpolipemizzante(): TerapiaIpolipemizzante {
  return {
    statine: createEmptyStatinaSelection(),
    ezetimibe: createEmptyEzetimibeSelection(),
    fibrati: createEmptyDoseSelection(),
    omega3: createEmptyDoseSelection(),
    acido_bempedoico: createEmptyDoseSelection(),
    repatha: createEmptyDoseSelection(),
    praluent: createEmptyDoseSelection(),
    leqvio: createEmptyDoseSelection()
  };
}

function normalizeDoseSelection(input?: Partial<DoseSelection> | null): DoseSelection {
  const merged = {
    ...createEmptyDoseSelection(),
    ...(input || {})
  };

  if (!merged.enabled) {
    return createEmptyDoseSelection();
  }

  return merged;
}

function normalizeStatinaSelection(input?: Partial<StatinaSelection> | null): StatinaSelection {
  const merged = {
    ...createEmptyStatinaSelection(),
    ...(input || {})
  };

  if (!merged.enabled) {
    return createEmptyStatinaSelection();
  }

  return merged;
}

function normalizeEzetimibeSelection(input?: Partial<EzetimibeSelection> | null): EzetimibeSelection {
  const merged = {
    ...createEmptyEzetimibeSelection(),
    ...(input || {})
  };

  if (!merged.enabled) {
    return createEmptyEzetimibeSelection();
  }

  return merged;
}

export function normalizeTerapiaIpolipemizzante(
  input?: Partial<TerapiaIpolipemizzante> | null
): TerapiaIpolipemizzante {
  const base = createEmptyTerapiaIpolipemizzante();
  const merged = {
    ...base,
    ...(input || {})
  };

  const acidoBempedoico = normalizeDoseSelection(merged.acido_bempedoico);

  return {
    statine: normalizeStatinaSelection(merged.statine),
    ezetimibe: normalizeEzetimibeSelection(merged.ezetimibe),
    fibrati: normalizeDoseSelection(merged.fibrati),
    omega3: normalizeDoseSelection(merged.omega3),
    acido_bempedoico: acidoBempedoico.enabled
      ? { enabled: true, dose: bempedoicoDose }
      : createEmptyDoseSelection(),
    repatha: normalizeDoseSelection(merged.repatha),
    praluent: normalizeDoseSelection(merged.praluent),
    leqvio: normalizeDoseSelection(merged.leqvio)
  };
}

export function parseTerapiaIpolipemizzante(raw?: string | null): TerapiaIpolipemizzante {
  if (!raw) return createEmptyTerapiaIpolipemizzante();

  try {
    return normalizeTerapiaIpolipemizzante(JSON.parse(raw) as Partial<TerapiaIpolipemizzante>);
  } catch {
    return createEmptyTerapiaIpolipemizzante();
  }
}

export function serializeTerapiaIpolipemizzante(data: TerapiaIpolipemizzante): string {
  return JSON.stringify(normalizeTerapiaIpolipemizzante(data));
}

export function validateTerapiaIpolipemizzante(data: TerapiaIpolipemizzante): string | null {
  const normalized = normalizeTerapiaIpolipemizzante(data);

  if (normalized.statine.enabled && !normalized.statine.dose) {
    return 'Seleziona statina e dosaggio';
  }

  if (normalized.ezetimibe.enabled && !normalized.ezetimibe.modalita) {
    return "Seleziona la modalita' di ezetimibe";
  }

  if (normalized.fibrati.enabled && !normalized.fibrati.dose) {
    return 'Seleziona la dose dei fibrati';
  }

  if (normalized.omega3.enabled && !normalized.omega3.dose) {
    return 'Seleziona la dose di Omega 3';
  }

  if (normalized.repatha.enabled && !normalized.repatha.dose) {
    return 'Seleziona la dose di Repatha';
  }

  if (normalized.praluent.enabled && !normalized.praluent.dose) {
    return 'Seleziona la dose di Praluent';
  }

  if (normalized.leqvio.enabled && !normalized.leqvio.dose) {
    return 'Seleziona la dose di Leqvio';
  }

  return null;
}
