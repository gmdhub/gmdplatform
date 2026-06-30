// Configurazione dei blocchi per ogni ambulatorio

export interface VisitBlockConfig {
  id: string;
  component: string;
  allAmbulatori?: boolean;
  ambulatori: number[]; // IDs degli ambulatori che possono vedere questo blocco
}

export type VisitBlockAmbulatorioContext = {
  nome?: string | null;
  name?: string | null;
  code?: string | null;
};

const SCA_VISIBLE_BLOCKS = new Set([
  'fattori-rischio-cv',
  'anamnesi',
  'terapia-domiciliare',
  'valutazione-odierna',
  'esami-ematici',
  'valutazione-rischio-cv',
  'firme-visita'
]);

export const visitBlocksConfig: VisitBlockConfig[] = [
  {
    id: 'fattori-rischio-cv',
    component: 'FattoriRischioCV',
    allAmbulatori: true,
    ambulatori: []
  },
  {
    id: 'fh-assessment',
    component: 'IpercolesterolemiaFamiliareFH',
    allAmbulatori: true,
    ambulatori: []
  },
  {
    id: 'anamnesi',
    component: 'VisitTextSection',
    ambulatori: []
  },
  {
    id: 'terapia-ipolipemizzante',
    component: 'TerapiaIpolipemizzante',
    allAmbulatori: true,
    ambulatori: []
  },
  {
    id: 'anamnesi-cardiologica',
    component: 'AnamnesiCardiologica',
    ambulatori: [1] // Solo Ambulatorio Dislipidemie (ID 1)
  },
  {
    id: 'terapia-domiciliare',
    component: 'TerapiaDomiciliare',
    allAmbulatori: true,
    ambulatori: []
  },
  {
    id: 'valutazione-odierna',
    component: 'ValutazioneOdierna',
    allAmbulatori: true,
    ambulatori: []
  },
  {
    id: 'esami-ematici',
    component: 'EsamiEmatici',
    allAmbulatori: true,
    ambulatori: []
  },
  {
    id: 'valutazione-rischio-cv',
    component: 'ValutazioneRischioCardiovascolare',
    allAmbulatori: true,
    ambulatori: []
  },
  {
    id: 'ecocardiografia',
    component: 'Ecocardiografia',
    ambulatori: [] // Blocco disattivato
  },
  {
    id: 'firme-visita',
    component: 'FirmeVisita',
    allAmbulatori: true,
    ambulatori: []
  }
  // Altri blocchi verranno aggiunti qui
];

function normalizeAmbulatorioText(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

export function isScaAmbulatorio(context?: VisitBlockAmbulatorioContext | null): boolean {
  if (!context) {
    return false;
  }

  const code = normalizeAmbulatorioText(context.code);
  const name = normalizeAmbulatorioText(context.nome ?? context.name);
  return code === 'sca' || name === 'ambulatorio sca';
}

/**
 * Verifica se un blocco è visibile per un dato ambulatorio
 */
export function isBlockVisibleForAmbulatorio(
  blockId: string,
  ambulatorioId: number,
  ambulatorio?: VisitBlockAmbulatorioContext | null
): boolean {
  const block = visitBlocksConfig.find((b) => b.id === blockId);
  if (!block) return false;
  if (isScaAmbulatorio(ambulatorio)) return SCA_VISIBLE_BLOCKS.has(blockId);
  if (block.allAmbulatori) return true;
  return block.ambulatori.includes(ambulatorioId);
}

/**
 * Ottiene tutti i blocchi visibili per un ambulatorio
 */
export function getVisibleBlocksForAmbulatorio(
  ambulatorioId: number,
  ambulatorio?: VisitBlockAmbulatorioContext | null
): string[] {
  return visitBlocksConfig
    .filter((block) => isBlockVisibleForAmbulatorio(block.id, ambulatorioId, ambulatorio))
    .map((block) => block.id);
}
