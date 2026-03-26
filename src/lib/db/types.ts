// GMD Medical Platform - Database Types

export interface User {
  id: number;
  username: string;
  password_hash?: string;
  role: 'admin' | 'medico' | 'infermiere';
  nome: string;
  cognome: string;
  created_at: string;
  updated_at: string;
}

export interface Ambulatorio {
  id: number;
  nome: string;
  logo_path: string | null;
  color_primary: string;
  color_secondary: string;
  color_accent: string;
  indirizzo?: string;
  telefono?: string;
  email?: string;
  durata_minima_visita_minuti?: number;
  durata_standard_visita_minuti?: number;
  created_at: string;
  updated_at: string;
}

export type GiornoSettimana = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface AmbulatorioOperatingWindow {
  id: number;
  ambulatorio_id: number;
  weekday: GiornoSettimana;
  ora_inizio: string;
  ora_fine: string;
  max_pazienti_giorno: number;
  created_at: string;
  updated_at: string;
}

export interface UpsertAmbulatorioOperatingWindowInput {
  weekday: GiornoSettimana;
  ora_inizio: string;
  ora_fine: string;
  max_pazienti_giorno: number;
}

export interface AmbulatorioOperatingSettings {
  ambulatorioId: number;
  durataMinimaVisitaMinuti: number;
  durataStandardVisitaMinuti: number;
  windows: AmbulatorioOperatingWindow[];
}

export interface Paziente {
  id: number;
  ambulatorio_id: number;
  nome: string;
  cognome: string;
  data_nascita: string;
  luogo_nascita: string;
  codice_fiscale: string;
  sesso: 'M' | 'F' | 'Altro';
  esenzioni: string;
  indirizzo: string;
  citta: string;
  cap: string;
  provincia: string;
  telefono?: string;
  email?: string;
  created_at: string;
  updated_at: string;
}

export interface CreatePazienteInput {
  ambulatorio_id: number;
  nome: string;
  cognome: string;
  data_nascita: string;
  luogo_nascita: string;
  codice_fiscale: string;
  sesso: 'M' | 'F' | 'Altro';
  esenzioni?: string;
  indirizzo?: string;
  citta?: string;
  cap?: string;
  provincia?: string;
  telefono?: string;
  email?: string;
}

export interface CreatePazienteRapidoInput {
  ambulatorio_id: number;
  nome: string;
  cognome: string;
  telefono: string;
}

export interface UpdatePazienteInput extends Partial<CreatePazienteInput> {
  id: number;
}

export type DiabeteTipo = '' | '1' | '2';
export type FHRiskClassification = 'Improbabile' | 'Possibile' | 'Probabile' | 'Definita';
export type UntreatedLdlRange = '' | '155-189' | '190-249' | '250-329' | '>=330';
export type RischioCVLevel = '' | 'basso' | 'moderato' | 'alto' | 'molto_alto';
export type RischioCVStatus = 'non_valutabile' | 'raggiunto' | 'non_raggiunto';
export type LDLSource = '' | 'diretto' | 'calcolato';
export type EsameEmaticoKey =
  | 'hb'
  | 'plt'
  | 'creatinina'
  | 'egfr'
  | 'colesterolo_totale'
  | 'hdl'
  | 'trigliceridi'
  | 'ldl_calcolato'
  | 'ldl_diretto'
  | 'lipoproteina_a'
  | 'emoglobina_glicata'
  | 'glicemia'
  | 'ast'
  | 'alt'
  | 'bilirubina_totale'
  | 'cpk';

export interface EsamiEmaticiValues {
  data_ee: string;
  hb: string;
  plt: string;
  creatinina: string;
  egfr: string;
  colesterolo_totale: string;
  hdl: string;
  trigliceridi: string;
  ldl_calcolato: string;
  ldl_diretto: string;
  lipoproteina_a: string;
  emoglobina_glicata: string;
  glicemia: string;
  ast: string;
  alt: string;
  bilirubina_totale: string;
  cpk: string;
}

export interface ValutazioneRischioCardiovascolare {
  rischio: RischioCVLevel;
  targetLdl: number | null;
  ldlAttuale: number | null;
  ldlSource: LDLSource;
  status: RischioCVStatus;
  statusMessage: string;
}

export type TitoloFirmaMedico = 'dott' | 'dott.ssa';

export interface FirmaMedicoInFormazione {
  nome: string;
  titolo: TitoloFirmaMedico;
}

export interface FirmeVisita {
  cardiologoNome: string;
  cardiologoTitolo: TitoloFirmaMedico;
  mediciInFormazione: FirmaMedicoInFormazione[];
}

export interface PianificazioneFollowUp {
  dataOraProssimaVisita: string;
  motivoProssimaVisita: string;
  esamiEmaticiDaFare: string;
}

export interface PreviousExamValue {
  value: string;
  date: string;
}

export type PreviousEsamiEmaticiMap = Partial<Record<EsameEmaticoKey, PreviousExamValue>>;

export interface FHAssessment {
  enabled: boolean;
  familyHistoryOnePoint: boolean;
  familyHistoryTwoPoints: boolean;
  clinicalPrematureCAD: boolean;
  clinicalPrematureCerebralOrPeripheral: boolean;
  physicalTendonXanthomas: boolean;
  physicalCornealArcusBefore45: boolean;
  untreatedLdlRange: UntreatedLdlRange;
  geneticMutation: boolean;
  totalScore: number;
  classification: FHRiskClassification;
}

export interface DoseSelection {
  enabled: boolean;
  dose: string;
}

export interface StatinaSelection {
  enabled: boolean;
  dose: string;
}

export interface EzetimibeSelection {
  enabled: boolean;
  modalita: string;
}

export interface TerapiaIpolipemizzante {
  statine: StatinaSelection;
  ezetimibe: EzetimibeSelection;
  fibrati: DoseSelection;
  omega3: DoseSelection;
  acido_bempedoico: DoseSelection;
  repatha: DoseSelection;
  praluent: DoseSelection;
  leqvio: DoseSelection;
}

export interface Visita {
  id: number;
  ambulatorio_id: number;
  paziente_id: number;
  medico_id: number;
  previous_version_id?: number | null;
  is_current_version?: number;
  data_visita: string;
  tipo_visita: string;
  motivo: string;
  // Dati antropometrici
  altezza?: number;
  peso?: number;
  bmi?: number;
  bsa?: number;
  anamnesi_cardiologica?: string;
  anamnesi_internistica?: string;
  terapia_domiciliare?: string;
  valutazione_odierna?: string;
  esami_ematici?: string;
  ecocardiografia?: string;
  fh_assessment?: string;
  terapia_ipolipemizzante?: string;
  valutazione_rischio_cv?: string;
  firme_visita?: string;
  pianificazione_followup?: string;
  conclusioni?: string;
  anamnesi?: string;
  esame_obiettivo?: string;
  diagnosi?: string;
  terapia?: string;
  note?: string;
  created_at: string;
  updated_at: string;
  // Joined fields
  paziente_nome?: string;
  paziente_cognome?: string;
  paziente_codice_fiscale?: string;
  medico_nome?: string;
  medico_cognome?: string;
  internal_revision_id?: string;
  internal_encounter_id?: string;
}

export interface CreateVisitaInput {
  ambulatorio_id: number;
  paziente_id: number;
  medico_id: number;
  previous_version_id?: number | null;
  is_current_version?: number;
  data_visita: string;
  tipo_visita: string;
  motivo: string;
  // Dati antropometrici
  altezza?: number;
  peso?: number;
  bmi?: number;
  bsa?: number;
  anamnesi_cardiologica?: string;
  anamnesi_internistica?: string;
  terapia_domiciliare?: string;
  valutazione_odierna?: string;
  esami_ematici?: string;
  ecocardiografia?: string;
  fh_assessment?: string;
  terapia_ipolipemizzante?: string;
  valutazione_rischio_cv?: string;
  firme_visita?: string;
  pianificazione_followup?: string;
  conclusioni?: string;
  anamnesi?: string;
  esame_obiettivo?: string;
  diagnosi?: string;
  terapia?: string;
  note?: string;
}

export interface UpdateVisitaInput extends Partial<CreateVisitaInput> {
  id: number;
}

export type OrigineAppuntamento = 'manuale' | 'followup_visita';

export interface Appuntamento {
  id: number;
  ambulatorio_id: number;
  paziente_id: number;
  data_ora_inizio: string;
  data_ora_fine: string;
  durata_minuti: number;
  motivo?: string | null;
  origine: OrigineAppuntamento;
  source_visita_id?: number | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  paziente_nome?: string;
  paziente_cognome?: string;
  paziente_codice_fiscale?: string;
  paziente_data_nascita?: string;
  paziente_telefono?: string;
}

export interface CreateAppuntamentoManualeInput {
  ambulatorio_id: number;
  paziente_id: number;
  data_ora_inizio: string;
  data_ora_fine: string;
  motivo?: string;
}

export interface UpdateAppuntamentoInput {
  id: number;
  paziente_id?: number;
  data_ora_inizio?: string;
  data_ora_fine?: string;
  motivo?: string;
}

export type AppuntamentoAdjustmentType = 'trim_previous_end' | 'trim_new_end' | 'trim_next_start';

export interface AppuntamentoAdjustment {
  type: AppuntamentoAdjustmentType;
  appuntamentoId: number;
  oldEnd: string;
  newEnd: string;
  pazienteNome?: string;
}

export interface AppuntamentoWriteRequirements {
  requiresOutsideHoursConfirmation: boolean;
  requiresOverlapAdjustmentConfirmation: boolean;
  outsideHoursMessage?: string;
  overlapAdjustments: AppuntamentoAdjustment[];
}

export interface AppuntamentoWriteOptions {
  confirmOutsideHours?: boolean;
  confirmOverlapAdjustments?: boolean;
}

export interface AppuntamentoWriteOutcome {
  saved: boolean;
  appuntamentoId?: number;
  requirements?: AppuntamentoWriteRequirements;
  appliedAdjustments?: AppuntamentoAdjustment[];
}

export interface AppuntamentoSlotDisponibilita {
  date: string;
  time: string;
  dateTime: string;
  endDateTime: string;
  insideWorkingHours: boolean;
  available: boolean;
  appuntamento: Appuntamento | null;
}

export interface SlotAvailabilityCheck {
  available: boolean;
  conflict: Appuntamento | null;
  suggestedTimes: string[];
}

export type FirstSlotSearchMode = 'urgent' | 'quarter_hour';

export interface FindFirstSlotParams {
  ambulatorioId: number;
  fromDateTime?: string;
  horizonDays?: number;
}

export interface FirstSlotSearchResult {
  found: boolean;
  startDateTime: string | null;
  endDateTime: string | null;
  requiresAdjustmentHint: boolean;
  reasonIfNotFound?: string;
}

export interface DailyAppointmentCount {
  date: string;
  total: number;
}

export interface FattoriRischioCV {
  id: number;
  visita_id: number;
  familiarita: boolean;
  familiarita_note?: string;
  ipertensione: boolean;
  diabete: boolean;
  diabete_durata?: string;
  diabete_tipo?: DiabeteTipo;
  dislipidemia: boolean;
  obesita: boolean;
  fumo: string; // 'si', 'no', 'ex'
  fumo_ex_eta?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateFattoriRischioCVInput {
  visita_id: number;
  familiarita: boolean;
  familiarita_note?: string;
  ipertensione: boolean;
  diabete: boolean;
  diabete_durata?: string;
  diabete_tipo?: DiabeteTipo;
  dislipidemia: boolean;
  obesita: boolean;
  fumo: string; // 'si', 'no', 'ex'
  fumo_ex_eta?: string;
}

export interface UpdateFattoriRischioCVInput extends Partial<CreateFattoriRischioCVInput> {
  id: number;
}
