<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import type {
    CalendarOptions,
    DatesSetArg,
    EventClickArg,
    EventDropArg,
    EventInput
  } from '@fullcalendar/core';
  import dayGridPlugin from '@fullcalendar/daygrid';
  import timeGridPlugin from '@fullcalendar/timegrid';
  import interactionPlugin from '@fullcalendar/interaction';
  import itLocale from '@fullcalendar/core/locales/it';
  import FullCalendar from 'svelte-fullcalendar';
  import { sidebarCollapsedStore } from '$lib/stores/sidebar';
  import { ambulatorioStore } from '$lib/stores/ambulatorio';
  import { toastStore } from '$lib/stores/toast';
  import {
    VISIT_SETTINGS_REQUIRED_MESSAGE,
    createAppuntamentoManuale,
    deleteAppuntamento,
    findFirstQuarterHourSlot,
    findFirstUrgentSlot,
    getAppuntamentiByRange,
    getDailyAppointmentCountsByRange,
    normalizeAppuntamentoDateTimeInput,
    updateAppuntamento
  } from '$lib/db/appuntamenti';
  import { getAmbulatorioOperatingSettingsById } from '$lib/db/ambulatori';
  import { createPazienteRapido, getPazientiByAmbulatorio } from '$lib/db/pazienti';
  import type {
    AmbulatorioOperatingSettings,
    Appuntamento,
    FirstSlotSearchMode,
    AppuntamentoWriteOptions,
    AppuntamentoWriteOutcome,
    Paziente
  } from '$lib/db/types';
  import Card from '$lib/components/Card.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { jsPDF } from 'jspdf';
  import { resolveAmbulatorioReportDirectory, sanitizeReportFolderName } from '$lib/utils/report-storage';

  type CalendarView = 'dayGridMonth' | 'timeGridDay';

  type AppointmentFormState = {
    pazienteId: number;
    date: string;
    startTime: string;
    endTime: string;
    motivo: string;
  };

  type QuickPatientFormState = {
    nome: string;
    cognome: string;
    telefono: string;
  };

  type PatientModalTab = 'search' | 'quick_create';

  const viewLabels: Record<CalendarView, string> = {
    dayGridMonth: 'Mese',
    timeGridDay: 'Giorno'
  };

  const MIN_ALLOWED_VISIT_DURATION_MINUTES = 10;
  const CALENDAR_FALLBACK_MIN_TIME = '00:00:00';
  const CALENDAR_FALLBACK_MAX_TIME = '24:00:00';
  const MIN_PATIENT_SEARCH_CHARS = 2;
  const MAX_PATIENT_SUGGESTIONS = 10;
  const calendarPlugins = [dayGridPlugin, timeGridPlugin, interactionPlugin];
  const today = new Date();

  $: ambulatorioId = Number.parseInt($page.params.id || '0', 10);

  let calendarRef: FullCalendar | null = null;
  let calendarOptions: CalendarOptions;
  let loading = true;
  let loadingPatients = false;
  let creatingQuickPatient = false;
  let savingAppointment = false;
  let deletingAppointment = false;
  let currentView: CalendarView = 'dayGridMonth';
  let calendarTitle = '';
  let jumpDate = formatDateOnly(today);
  let currentRangeStart = '';
  let currentRangeEndExclusive = '';
  let appuntamenti: Appuntamento[] = [];
  let calendarEvents: EventInput[] = [];
  let dailyCounts = new Map<string, number>();
  let daysWithAppointments = new Set<string>();
  let patients: Paziente[] = [];
  let operatingSettings: AmbulatorioOperatingSettings | null = null;
  let standardVisitDurationMinutes = 0;
  let calendarSlotMinTime = CALENDAR_FALLBACK_MIN_TIME;
  let calendarSlotMaxTime = CALENDAR_FALLBACK_MAX_TIME;
  let calendarSlotDuration = '00:15:00';
  let calendarBusinessHours: CalendarOptions['businessHours'] = false;
  let loadedAmbulatorioId = 0;
  let showAppointmentModal = false;
  let patientModalTab: PatientModalTab = 'search';
  let patientSearchTerm = '';
  let patientSearchFocused = false;
  let patientSearchBlurTimeout: ReturnType<typeof setTimeout> | null = null;
  let showPatientSearchSuggestions = false;
  let editingAppointment: Appuntamento | null = null;
  let searchingFirstSlotMode: FirstSlotSearchMode | null = null;
  let nextUrgentSearchCursor: string | null = null;
  let nextQuarterHourSearchCursor: string | null = null;
  let printingDailyAgenda = false;
  let appointmentForm: AppointmentFormState = {
    pazienteId: 0,
    date: formatDateOnly(today),
    startTime: '00:00',
    endTime: '00:15',
    motivo: ''
  };
  let quickPatientForm: QuickPatientFormState = {
    nome: '',
    cognome: '',
    telefono: ''
  };
  let quickPatientErrors: Partial<Record<keyof QuickPatientFormState, string>> = {};
  let normalizedPatientSearchTerm = '';
  let filteredPatientsForModal: Paziente[] = [];
  let selectedAppointmentPatient: Paziente | null = null;
  let showSelectedPatientCheck = false;

  $: ambulatorioPatients = patients
    .filter((patient) => patient.ambulatorio_id === ambulatorioId)
    .sort((left, right) => {
      const surnameComparison = left.cognome.localeCompare(right.cognome, 'it');
      if (surnameComparison !== 0) {
        return surnameComparison;
      }
      return left.nome.localeCompare(right.nome, 'it');
    });
  $: isEditing = editingAppointment !== null;
  $: isFollowUpAppointment = editingAppointment?.origine === 'followup_visita';
  $: modalTitle = isEditing ? 'Modifica Appuntamento' : 'Nuovo Appuntamento';
  $: currentDayCount = dailyCounts.get(jumpDate) ?? 0;
  $: currentAmbulatorio = $ambulatorioStore.current;
  $: normalizedPatientSearchTerm = patientSearchTerm.trim().toLowerCase();
  $: filteredPatientsForModal = ambulatorioPatients
    .filter((patient) => {
      if (normalizedPatientSearchTerm.length < MIN_PATIENT_SEARCH_CHARS) {
        return false;
      }

      const nome = patient.nome.toLowerCase();
      const cognome = patient.cognome.toLowerCase();
      const fullName = `${cognome} ${nome}`;
      return (
        nome.includes(normalizedPatientSearchTerm) ||
        cognome.includes(normalizedPatientSearchTerm) ||
        fullName.includes(normalizedPatientSearchTerm)
      );
    })
    .slice(0, MAX_PATIENT_SUGGESTIONS);
  $: selectedAppointmentPatient =
    ambulatorioPatients.find((patient) => patient.id === appointmentForm.pazienteId) ?? null;
  $: showSelectedPatientCheck =
    Boolean(selectedAppointmentPatient) &&
    normalizedPatientSearchTerm.length > 0 &&
    normalizePatientDisplayLabel(patientSearchTerm) ===
      normalizePatientDisplayLabel(
        `${selectedAppointmentPatient?.cognome ?? ''} ${selectedAppointmentPatient?.nome ?? ''}`
      );
  $: showPatientSearchSuggestions =
    patientModalTab === 'search' &&
    patientSearchFocused &&
    !showSelectedPatientCheck &&
    normalizedPatientSearchTerm.length >= MIN_PATIENT_SEARCH_CHARS;
  $: standardVisitDurationMinutes = hasConfiguredVisitTimingSettings(operatingSettings)
    ? Number(operatingSettings.durataStandardVisitaMinuti)
    : 0;
  $: {
    if (ambulatorioId > 0 && ambulatorioId !== loadedAmbulatorioId) {
      loadedAmbulatorioId = ambulatorioId;
      nextUrgentSearchCursor = null;
      nextQuarterHourSearchCursor = null;
      void initializeAmbulatorioContext();
    }
  }

  function formatDateOnly(date: Date): string {
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseTimeToMinutes(value: string): number | null {
    const match = value.trim().match(/^(\d{2}):(\d{2})$/);
    if (!match) {
      return null;
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (
      Number.isNaN(hours) ||
      Number.isNaN(minutes) ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59
    ) {
      return null;
    }

    return (hours * 60) + minutes;
  }

  function hasConfiguredVisitTimingSettings(
    settings: AmbulatorioOperatingSettings | null
  ): settings is AmbulatorioOperatingSettings {
    if (!settings) {
      return false;
    }

    const minDuration = Number(settings.durataMinimaVisitaMinuti);
    const standardDuration = Number(settings.durataStandardVisitaMinuti);
    if (
      !Number.isInteger(minDuration) ||
      minDuration < MIN_ALLOWED_VISIT_DURATION_MINUTES ||
      !Number.isInteger(standardDuration) ||
      standardDuration < minDuration
    ) {
      return false;
    }

    return settings.windows.some((window) => {
      const startMinutes = parseTimeToMinutes(window.ora_inizio);
      const endMinutes = parseTimeToMinutes(window.ora_fine);
      return startMinutes !== null && endMinutes !== null && startMinutes < endMinutes;
    });
  }

  function ensureVisitTimingSettingsConfigured(): boolean {
    if (hasConfiguredVisitTimingSettings(operatingSettings)) {
      return true;
    }

    toastStore.show('error', VISIT_SETTINGS_REQUIRED_MESSAGE);
    return false;
  }

  function resetQuickPatientForm(): void {
    quickPatientForm = {
      nome: '',
      cognome: '',
      telefono: ''
    };
  }

  function resetQuickPatientErrors(): void {
    quickPatientErrors = {};
  }

  function clearQuickPatientError(field: keyof QuickPatientFormState): void {
    if (!quickPatientErrors[field]) {
      return;
    }

    const nextErrors = { ...quickPatientErrors };
    delete nextErrors[field];
    quickPatientErrors = nextErrors;
  }

  function resetPatientModalState(): void {
    if (patientSearchBlurTimeout) {
      clearTimeout(patientSearchBlurTimeout);
      patientSearchBlurTimeout = null;
    }
    patientSearchFocused = false;
    patientModalTab = 'search';
    patientSearchTerm = '';
    resetQuickPatientForm();
    resetQuickPatientErrors();
  }

  function switchPatientModalTab(nextTab: PatientModalTab): void {
    if (patientSearchBlurTimeout) {
      clearTimeout(patientSearchBlurTimeout);
      patientSearchBlurTimeout = null;
    }
    patientSearchFocused = false;
    patientModalTab = nextTab;
    if (nextTab === 'search') {
      resetQuickPatientErrors();
      return;
    }

    patientSearchTerm = '';
  }

  function getPatientDisplayLabel(patient: Pick<Paziente, 'cognome' | 'nome'>): string {
    return `${patient.cognome} ${patient.nome}`.trim();
  }

  function normalizePatientDisplayLabel(label: string): string {
    return label.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function findPatientByDisplayLabel(label: string): Paziente | null {
    const normalizedLabel = normalizePatientDisplayLabel(label);
    if (!normalizedLabel) {
      return null;
    }

    return (
      ambulatorioPatients.find(
        (patient) => normalizePatientDisplayLabel(getPatientDisplayLabel(patient)) === normalizedLabel
      ) ?? null
    );
  }

  function handlePatientSearchInput(): void {
    const normalizedInput = normalizePatientDisplayLabel(patientSearchTerm);

    if (normalizedInput.length === 0) {
      if (appointmentForm.pazienteId !== 0) {
        appointmentForm = {
          ...appointmentForm,
          pazienteId: 0
        };
      }
      return;
    }

    const matchedPatient = findPatientByDisplayLabel(patientSearchTerm);

    if (matchedPatient) {
      if (appointmentForm.pazienteId !== matchedPatient.id) {
        appointmentForm = {
          ...appointmentForm,
          pazienteId: matchedPatient.id
        };
      }
      return;
    }

    if (appointmentForm.pazienteId !== 0) {
      appointmentForm = {
        ...appointmentForm,
        pazienteId: 0
      };
    }
  }

  function handlePatientSearchFocus(): void {
    if (patientSearchBlurTimeout) {
      clearTimeout(patientSearchBlurTimeout);
      patientSearchBlurTimeout = null;
    }
    patientSearchFocused = true;
  }

  function handlePatientSearchBlur(): void {
    if (patientSearchBlurTimeout) {
      clearTimeout(patientSearchBlurTimeout);
    }

    patientSearchBlurTimeout = setTimeout(() => {
      patientSearchFocused = false;
      patientSearchBlurTimeout = null;
    }, 100);
  }

  function handlePatientSearchOptionSelect(patient: Paziente): void {
    selectPatientForAppointment(patient.id, getPatientDisplayLabel(patient));
  }

  function selectPatientForAppointment(patientId: number, patientLabel?: string): void {
    appointmentForm = {
      ...appointmentForm,
      pazienteId: Number(patientId)
    };

    const selectedPatient =
      ambulatorioPatients.find((patient) => patient.id === Number(patientId)) ?? null;
    if (selectedPatient) {
      patientSearchTerm = getPatientDisplayLabel(selectedPatient);
      return;
    }

    if (patientLabel) {
      patientSearchTerm = patientLabel.trim();
    }
  }

  function validateQuickPatientForm(): boolean {
    const nextErrors: Partial<Record<keyof QuickPatientFormState, string>> = {};

    if (!quickPatientForm.nome.trim()) {
      nextErrors.nome = 'Nome obbligatorio';
    }
    if (!quickPatientForm.cognome.trim()) {
      nextErrors.cognome = 'Cognome obbligatorio';
    }
    if (!quickPatientForm.telefono.trim()) {
      nextErrors.telefono = 'Telefono obbligatorio';
    }

    quickPatientErrors = nextErrors;
    return Object.keys(nextErrors).length === 0;
  }

  function formatTimeOnly(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  function formatDateTime(date: Date): string {
    return `${formatDateOnly(date)}T${formatTimeOnly(date)}`;
  }

  function formatLongDateLabel(value: string): string {
    if (!value) {
      return '';
    }

    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat('it-IT', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }).format(parsed);
  }

  function getDailyAppointmentsForDate(dateValue: string): Appuntamento[] {
    return appuntamenti
      .filter((appointment) => normalizeAppuntamentoDateTimeInput(appointment.data_ora_inizio).slice(0, 10) === dateValue)
      .sort((left, right) =>
        normalizeAppuntamentoDateTimeInput(left.data_ora_inizio).localeCompare(
          normalizeAppuntamentoDateTimeInput(right.data_ora_inizio)
        )
      );
  }

  function buildDailyAgendaPdf(appointments: Appuntamento[], dateValue: string): Uint8Array {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margins = {
      left: 36,
      right: 36,
      top: 34,
      bottom: 42
    };
    const contentWidth = pageWidth - margins.left - margins.right;
    const headerHeight = 94;
    const footerHeight = 24;
    const tableHeaderHeight = 24;
    const cellPaddingX = 7;
    const cellPaddingY = 6;
    const rowLineHeight = 12;
    const minRowHeight = 26;

    const colors = {
      headerFill: [30, 64, 175] as [number, number, number],
      headerText: [255, 255, 255] as [number, number, number],
      tableHeaderFill: [226, 232, 240] as [number, number, number],
      tableBorder: [203, 213, 225] as [number, number, number],
      zebraFill: [248, 250, 252] as [number, number, number],
      textPrimary: [15, 23, 42] as [number, number, number],
      textSecondary: [71, 85, 105] as [number, number, number]
    };

    const ambulatorioName = currentAmbulatorio?.nome || `Ambulatorio ${ambulatorioId}`;
    const prettyDate = formatLongDateLabel(dateValue) || dateValue;
    const generatedAt = new Intl.DateTimeFormat('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date());

    const columns = [
      { key: 'timeRange', title: 'Orario', width: 82 },
      { key: 'patient', title: 'Paziente', width: 188 },
      { key: 'phone', title: 'Telefono', width: 108 },
      { key: 'reason', title: 'Motivo', width: contentWidth - 82 - 188 - 108 }
    ] as const;

    type AppointmentPrintRow = {
      timeRange: string;
      patient: string;
      phone: string;
      reason: string;
    };

    const rows: AppointmentPrintRow[] =
      appointments.length > 0
        ? appointments.map((appointment) => {
            const start = normalizeAppuntamentoDateTimeInput(appointment.data_ora_inizio).slice(11, 16);
            const end = normalizeAppuntamentoDateTimeInput(appointment.data_ora_fine).slice(11, 16);
            const patientName = [appointment.paziente_cognome, appointment.paziente_nome]
              .filter(Boolean)
              .join(' ')
              .trim() || 'Paziente non specificato';
            const birthDate = formatBirthDateLabel(appointment.paziente_data_nascita);
            const phone = String(appointment.paziente_telefono || '').trim();
            const reason = String(appointment.motivo || '').trim();
            const patientLabel = birthDate ? `${patientName} (${birthDate})` : patientName;

            return {
              timeRange: `${start}-${end}`,
              patient: patientLabel,
              phone: phone || '-',
              reason: reason || '-'
            };
          })
        : [
            {
              timeRange: '-',
              patient: 'Nessun appuntamento programmato per questa giornata.',
              phone: '-',
              reason: '-'
            }
          ];

    let pageNumber = 1;
    let y = 0;

    const drawFooter = (pageIndex: number): void => {
      const footerY = pageHeight - margins.bottom;
      doc.setDrawColor(...colors.tableBorder);
      doc.setLineWidth(0.7);
      doc.line(margins.left, footerY - 12, pageWidth - margins.right, footerY - 12);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...colors.textSecondary);
      doc.text(`Generato il ${generatedAt}`, margins.left, footerY);
      doc.text(`Pagina ${pageIndex}`, pageWidth - margins.right, footerY, { align: 'right' });
    };

    const drawHeaderAndTableHeader = (pageIndex: number): number => {
      let currentY = margins.top;

      doc.setFillColor(...colors.headerFill);
      doc.roundedRect(margins.left, currentY, contentWidth, headerHeight, 8, 8, 'F');

      doc.setTextColor(...colors.headerText);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(17);
      doc.text('Agenda Giornaliera', margins.left + 14, currentY + 25);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.text(ambulatorioName, margins.left + 14, currentY + 44);
      doc.text(prettyDate, margins.left + 14, currentY + 60);

      doc.setFillColor(255, 255, 255);
      doc.roundedRect(pageWidth - margins.right - 132, currentY + 16, 118, 50, 6, 6, 'F');
      doc.setTextColor(...colors.headerFill);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text('Totale visite', pageWidth - margins.right - 73, currentY + 34, { align: 'center' });
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.text(String(appointments.length), pageWidth - margins.right - 73, currentY + 57, {
        align: 'center'
      });

      currentY += headerHeight + 14;

      doc.setFillColor(...colors.tableHeaderFill);
      doc.setDrawColor(...colors.tableBorder);
      doc.setLineWidth(0.8);
      doc.rect(margins.left, currentY, contentWidth, tableHeaderHeight, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...colors.textPrimary);

      let columnX = margins.left;
      for (const column of columns) {
        doc.text(column.title, columnX + cellPaddingX, currentY + 16);
        columnX += column.width;
        if (columnX < margins.left + contentWidth) {
          doc.line(columnX, currentY, columnX, currentY + tableHeaderHeight);
        }
      }

      drawFooter(pageIndex);
      return currentY + tableHeaderHeight;
    };

    const addPageWithHeader = (): void => {
      if (pageNumber > 1) {
        doc.addPage();
      }
      y = drawHeaderAndTableHeader(pageNumber);
    };

    const getCellLines = (text: string, width: number): string[] => {
      const normalized = text.trim() || '-';
      return doc.splitTextToSize(normalized, width - cellPaddingX * 2) as string[];
    };

    addPageWithHeader();

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);

      const cellLines = columns.map((column) => getCellLines(row[column.key], column.width));
      const rowLineCount = Math.max(...cellLines.map((lines) => lines.length));
      const rowHeight = Math.max(minRowHeight, rowLineCount * rowLineHeight + cellPaddingY * 2);

      const maxContentY = pageHeight - margins.bottom - footerHeight;
      if (y + rowHeight > maxContentY) {
        pageNumber += 1;
        addPageWithHeader();
      }

      if (index % 2 !== 0) {
        doc.setFillColor(...colors.zebraFill);
        doc.rect(margins.left, y, contentWidth, rowHeight, 'F');
      }

      doc.setDrawColor(...colors.tableBorder);
      doc.setLineWidth(0.6);
      doc.rect(margins.left, y, contentWidth, rowHeight, 'S');

      let columnX = margins.left;
      for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
        const column = columns[columnIndex];
        const lines = cellLines[columnIndex];
        doc.setTextColor(...colors.textPrimary);
        doc.text(lines, columnX + cellPaddingX, y + cellPaddingY + 9);

        columnX += column.width;
        if (columnX < margins.left + contentWidth) {
          doc.line(columnX, y, columnX, y + rowHeight);
        }
      }

      y += rowHeight;
    }

    const arrayBuffer = doc.output('arraybuffer');
    return new Uint8Array(arrayBuffer);
  }

  async function printDailyAgenda(): Promise<void> {
    if (printingDailyAgenda || !jumpDate || !ambulatorioId) {
      return;
    }

    printingDailyAgenda = true;
    try {
      const appointments = getDailyAppointmentsForDate(jumpDate);
      const pdfBytes = buildDailyAgendaPdf(appointments, jumpDate);

      const [{ mkdir, writeFile }, { join }, { openPath }] = await Promise.all([
        import('@tauri-apps/plugin-fs'),
        import('@tauri-apps/api/path'),
        import('@tauri-apps/plugin-opener')
      ]);

      const ambulatorioName = currentAmbulatorio?.nome || `Ambulatorio ${ambulatorioId}`;
      const ambulatorioDirectory = await resolveAmbulatorioReportDirectory(ambulatorioName);
      const printDirectory = await join(ambulatorioDirectory, 'Stampe Agenda');
      await mkdir(printDirectory, { recursive: true });

      const safeAmbulatorioName = sanitizeReportFolderName(ambulatorioName).replace(/\s+/g, '_');
      const fileDate = jumpDate.replace(/-/g, '');
      const outputPath = await join(
        printDirectory,
        `agenda_pazienti_${safeAmbulatorioName}_${fileDate}.pdf`
      );

      await writeFile(outputPath, pdfBytes, { create: true });
      await openPath(outputPath);
      toastStore.show('success', `PDF agenda creato e aperto in anteprima: ${outputPath}`);
    } catch (error) {
      console.error('Errore stampa agenda giornaliera:', error);
      toastStore.show('error', `Errore stampa agenda giornaliera: ${getErrorMessage(error)}`);
    } finally {
      printingDailyAgenda = false;
    }
  }

  function addMinutesToDateTime(dateTime: string, minutes: number): string {
    const date = new Date(normalizeAppuntamentoDateTimeInput(dateTime));
    date.setMinutes(date.getMinutes() + minutes);
    return formatDateTime(date);
  }

  function getDurationStringFromMinutes(minutes: number): string {
    const safeMinutes = Math.max(5, minutes);
    const hours = String(Math.floor(safeMinutes / 60)).padStart(2, '0');
    const remainingMinutes = String(safeMinutes % 60).padStart(2, '0');
    return `${hours}:${remainingMinutes}:00`;
  }

  function minutesToCalendarTime(totalMinutes: number): string {
    const normalized = Math.min(Math.max(totalMinutes, 0), 24 * 60);
    const hours = String(Math.floor(normalized / 60)).padStart(2, '0');
    const minutes = String(normalized % 60).padStart(2, '0');
    return `${hours}:${minutes}:00`;
  }

  function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    if (typeof error === 'string' && error.trim()) {
      return error;
    }

    return 'Errore sconosciuto';
  }

  function getCalendarApi() {
    return calendarRef?.getAPI() ?? null;
  }

  function getIsoWeekday(date: Date): number {
    const day = date.getDay();
    return day === 0 ? 7 : day;
  }

  function hasWorkingWindowForDate(date: Date): boolean {
    if (!operatingSettings) {
      return false;
    }

    const weekday = getIsoWeekday(date);
    return operatingSettings.windows.some((window) => window.weekday === weekday);
  }

  function applyCalendarOperatingSettings(settings: AmbulatorioOperatingSettings | null): void {
    if (!hasConfiguredVisitTimingSettings(settings)) {
      calendarBusinessHours = false;
      calendarSlotMinTime = CALENDAR_FALLBACK_MIN_TIME;
      calendarSlotMaxTime = CALENDAR_FALLBACK_MAX_TIME;
      return;
    }

    const windows = settings.windows.filter((window) => {
      const startMinutes = parseTimeToMinutes(window.ora_inizio);
      const endMinutes = parseTimeToMinutes(window.ora_fine);
      return startMinutes !== null && endMinutes !== null && startMinutes < endMinutes;
    });

    const allStartMinutes = windows
      .map((window) => parseTimeToMinutes(window.ora_inizio))
      .filter((value): value is number => value !== null);
    const allEndMinutes = windows
      .map((window) => parseTimeToMinutes(window.ora_fine))
      .filter((value): value is number => value !== null);

    if (allStartMinutes.length === 0 || allEndMinutes.length === 0) {
      calendarBusinessHours = false;
      calendarSlotMinTime = CALENDAR_FALLBACK_MIN_TIME;
      calendarSlotMaxTime = CALENDAR_FALLBACK_MAX_TIME;
      return;
    }

    calendarSlotDuration = getDurationStringFromMinutes(Number(settings.durataStandardVisitaMinuti));
    calendarSlotMinTime = minutesToCalendarTime(Math.min(...allStartMinutes));
    calendarSlotMaxTime = minutesToCalendarTime(Math.max(...allEndMinutes));

    const businessHours: NonNullable<CalendarOptions['businessHours']> = [];

    for (const window of windows) {
      businessHours.push({
        daysOfWeek: [window.weekday === 7 ? 0 : window.weekday],
        startTime: window.ora_inizio,
        endTime: window.ora_fine
      });
    }

    calendarBusinessHours = businessHours;
  }

  function syncJumpDateFromCalendar(): void {
    const api = getCalendarApi();
    if (!api) {
      return;
    }

    jumpDate = formatDateOnly(api.getDate());
  }

  function normalizeCalendarView(viewType: string): CalendarView {
    return viewType === 'timeGridDay' ? 'timeGridDay' : 'dayGridMonth';
  }

  function buildEventTitle(appointment: Appuntamento): string {
    const patientName = [appointment.paziente_cognome, appointment.paziente_nome]
      .filter(Boolean)
      .join(' ')
      .trim();
    const normalizedPatientName = patientName || 'Appuntamento';
    const birthDate = formatBirthDateLabel(appointment.paziente_data_nascita);
    const phone = String(appointment.paziente_telefono || '').trim();
    const reason = String(appointment.motivo || '').trim();

    const heading = birthDate
      ? `${normalizedPatientName} (${birthDate})`
      : normalizedPatientName;

    const tail: string[] = [];
    if (phone) {
      tail.push(phone);
    }
    if (reason) {
      tail.push(reason);
    }

    return tail.length > 0 ? `${heading} - ${tail.join(' - ')}` : heading;
  }

  function formatBirthDateLabel(value: string | undefined): string {
    if (!value) {
      return '';
    }

    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      return `${match[3]}/${match[2]}/${match[1]}`;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }

    return `${String(parsed.getDate()).padStart(2, '0')}/${String(parsed.getMonth() + 1).padStart(2, '0')}/${parsed.getFullYear()}`;
  }

  function mapAppointmentsToEvents(items: Appuntamento[]): EventInput[] {
    return items.map((appointment) => ({
      id: String(appointment.id),
      title: buildEventTitle(appointment),
      start: normalizeAppuntamentoDateTimeInput(appointment.data_ora_inizio),
      end: normalizeAppuntamentoDateTimeInput(appointment.data_ora_fine),
      classNames: appointment.origine === 'followup_visita'
        ? ['calendar-event', 'calendar-event-followup']
        : ['calendar-event', 'calendar-event-manual'],
      extendedProps: {
        origine: appointment.origine
      }
    }));
  }

  function areStringArraysEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) {
        return false;
      }
    }

    return true;
  }

  function syncCalendarEvents(nextEvents: EventInput[]): void {
    const api = getCalendarApi();
    if (!api) {
      return;
    }

    const pendingById = new Map<string, EventInput>();
    for (const nextEvent of nextEvents) {
      const eventId = typeof nextEvent.id === 'string' ? nextEvent.id : String(nextEvent.id ?? '');
      if (!eventId) {
        continue;
      }
      pendingById.set(eventId, nextEvent);
    }

    api.batchRendering(() => {
      for (const existingEvent of api.getEvents()) {
        const nextEvent = pendingById.get(existingEvent.id);
        if (!nextEvent) {
          existingEvent.remove();
          continue;
        }

        const nextTitle = typeof nextEvent.title === 'string' ? nextEvent.title : '';
        if (existingEvent.title !== nextTitle) {
          existingEvent.setProp('title', nextTitle);
        }

        const nextStart = typeof nextEvent.start === 'string' ? normalizeAppuntamentoDateTimeInput(nextEvent.start) : '';
        const nextEnd = typeof nextEvent.end === 'string' ? normalizeAppuntamentoDateTimeInput(nextEvent.end) : '';
        const currentStart = existingEvent.start ? formatDateTime(existingEvent.start) : '';
        const currentEnd = existingEvent.end ? formatDateTime(existingEvent.end) : '';
        if (nextStart && nextEnd && (nextStart !== currentStart || nextEnd !== currentEnd)) {
          existingEvent.setDates(nextStart, nextEnd);
        }

        const nextClassNames = Array.isArray(nextEvent.classNames)
          ? nextEvent.classNames.map((className) => String(className))
          : [];
        const currentClassNames = existingEvent.classNames ?? [];
        if (nextClassNames.length > 0 && !areStringArraysEqual(currentClassNames, nextClassNames)) {
          existingEvent.setProp('classNames', nextClassNames);
        }

        pendingById.delete(existingEvent.id);
      }

      for (const pendingEvent of pendingById.values()) {
        api.addEvent(pendingEvent);
      }
    });
  }

  function getCalendarRootElement(): HTMLElement | null {
    const api = getCalendarApi();
    if (!api) {
      return null;
    }

    const root = (api as unknown as { el?: HTMLElement }).el;
    return root instanceof HTMLElement ? root : null;
  }

  function refreshCalendarDecorations(): void {
    const root = getCalendarRootElement();
    if (!root) {
      return;
    }

    const monthDayCells = root.querySelectorAll<HTMLElement>('.fc-daygrid-day[data-date]');
    for (const dayCell of monthDayCells) {
      const dateValue = dayCell.dataset.date;
      if (!dateValue) {
        continue;
      }

      if (daysWithAppointments.has(dateValue)) {
        dayCell.classList.add('fc-day-has-appointments');
      } else {
        dayCell.classList.remove('fc-day-has-appointments');
      }

      const cellDate = new Date(`${dateValue}T00:00`);
      if (!Number.isNaN(cellDate.getTime()) && !hasWorkingWindowForDate(cellDate)) {
        dayCell.classList.add('fc-day-non-working');
      } else {
        dayCell.classList.remove('fc-day-non-working');
      }

      dayCell.querySelector('.day-count-badge')?.remove();
      const count = dailyCounts.get(dateValue) ?? 0;
      if (count <= 0) {
        continue;
      }

      const topCell = dayCell.querySelector('.fc-daygrid-day-top');
      if (!topCell) {
        continue;
      }

      const badge = document.createElement('span');
      badge.className = 'day-count-badge';
      badge.textContent = String(count);
      badge.title = `${count} visite`;
      topCell.appendChild(badge);
    }

    const shouldShowHeaderPills = currentView === 'timeGridDay';
    const headerCells = root.querySelectorAll<HTMLElement>('.fc-col-header-cell[data-date]');
    for (const headerCell of headerCells) {
      const header = headerCell.querySelector('.fc-col-header-cell-cushion');
      if (!header) {
        continue;
      }

      header.querySelector('.fc-day-count-pill')?.remove();

      if (!shouldShowHeaderPills) {
        continue;
      }

      const dateValue = headerCell.dataset.date;
      if (!dateValue) {
        continue;
      }

      const count = dailyCounts.get(dateValue) ?? 0;
      if (count <= 0) {
        continue;
      }

      const pill = document.createElement('span');
      pill.className = 'fc-day-count-pill';
      pill.textContent = String(count);
      pill.title = `${count} visite`;
      header.appendChild(pill);
    }
  }

  function dayCellClassNames(arg: { date: Date; view: { type: string } }): string[] {
    if (arg.view.type !== 'dayGridMonth') {
      return [];
    }

    const day = formatDateOnly(arg.date);
    const classes: string[] = [];
    if (daysWithAppointments.has(day)) {
      classes.push('fc-day-has-appointments');
    }

    if (!hasWorkingWindowForDate(arg.date)) {
      classes.push('fc-day-non-working');
    }

    return classes;
  }

  function dayCellDidMount(arg: { date: Date; view: { type: string }; el: HTMLElement }): void {
    if (arg.view.type !== 'dayGridMonth') {
      return;
    }

    arg.el.querySelector('.day-count-badge')?.remove();

    const day = formatDateOnly(arg.date);
    const count = dailyCounts.get(day) ?? 0;
    if (count <= 0) {
      return;
    }

    const topCell = arg.el.querySelector('.fc-daygrid-day-top');
    if (!topCell) {
      return;
    }

    const badge = document.createElement('span');
    badge.className = 'day-count-badge';
    badge.textContent = String(count);
    badge.title = `${count} visite`;
    topCell.appendChild(badge);
  }

  function dayHeaderDidMount(arg: { date: Date; view: { type: string }; el: HTMLElement }): void {
    if (arg.view.type !== 'timeGridDay') {
      return;
    }

    arg.el.querySelector('.fc-day-count-pill')?.remove();

    const day = formatDateOnly(arg.date);
    const count = dailyCounts.get(day) ?? 0;
    if (count <= 0) {
      return;
    }

    const header = arg.el.querySelector('.fc-col-header-cell-cushion');
    if (!header) {
      return;
    }

    const pill = document.createElement('span');
    pill.className = 'fc-day-count-pill';
    pill.textContent = String(count);
    pill.title = `${count} visite`;
    header.appendChild(pill);
  }

  function buildRequirementsMessage(outcome: AppuntamentoWriteOutcome): string {
    const requirements = outcome.requirements;
    if (!requirements) {
      return 'Conferma richiesta per la prenotazione.';
    }

    const blocks: string[] = [];
    if (requirements.requiresOutsideHoursConfirmation) {
      blocks.push(requirements.outsideHoursMessage || 'Appuntamento fuori orario/giorno di funzionamento.');
    }

    if (requirements.requiresOverlapAdjustmentConfirmation) {
      if (requirements.overlapAdjustments.length === 0) {
        blocks.push('Sono richiesti aggiustamenti automatici per evitare sovrapposizioni.');
      } else {
        const rows = requirements.overlapAdjustments.map((adjustment) => {
          if (adjustment.type === 'trim_previous_end') {
            const subject = `Appuntamento precedente${adjustment.pazienteNome ? ` (${adjustment.pazienteNome})` : ''}`;
            return `- ${subject}: fine ${adjustment.oldEnd.slice(11, 16)} -> ${adjustment.newEnd.slice(11, 16)}`;
          }

          if (adjustment.type === 'trim_next_start') {
            const subject = `Appuntamento successivo${adjustment.pazienteNome ? ` (${adjustment.pazienteNome})` : ''}`;
            return `- ${subject}: inizio ${adjustment.oldEnd.slice(11, 16)} -> ${adjustment.newEnd.slice(11, 16)}`;
          }

          return `- Nuovo appuntamento: fine ${adjustment.oldEnd.slice(11, 16)} -> ${adjustment.newEnd.slice(11, 16)}`;
        });
        blocks.push(`Aggiustamenti proposti:\n${rows.join('\n')}`);
      }
    }

    return blocks.join('\n\n');
  }

  async function executeWithConfirmations(
    operation: (options: AppuntamentoWriteOptions) => Promise<AppuntamentoWriteOutcome>
  ): Promise<AppuntamentoWriteOutcome | null> {
    let options: AppuntamentoWriteOptions = {};

    while (true) {
      const outcome = await operation(options);
      if (outcome.saved) {
        return outcome;
      }

      const requirements = outcome.requirements;
      if (!requirements) {
        return null;
      }

      if (requirements.requiresOutsideHoursConfirmation && !options.confirmOutsideHours) {
        const confirmed =
          typeof window === 'undefined'
            ? true
            : window.confirm(
                `${requirements.outsideHoursMessage || 'Appuntamento fuori orario/giorno di funzionamento.'}\n\nConfermi comunque la prenotazione?`
              );
        if (!confirmed) {
          return null;
        }

        options = {
          ...options,
          confirmOutsideHours: true
        };
        continue;
      }

      if (
        requirements.requiresOverlapAdjustmentConfirmation &&
        !options.confirmOverlapAdjustments
      ) {
        const confirmed =
          typeof window === 'undefined'
            ? true
            : window.confirm(
                `${buildRequirementsMessage(outcome)}\n\nConfermi le modifiche automatiche?`
              );

        if (!confirmed) {
          return null;
        }

        options = {
          ...options,
          confirmOverlapAdjustments: true
        };
        continue;
      }

      return null;
    }
  }

  function formatAppliedAdjustments(outcome: AppuntamentoWriteOutcome): string {
    const adjustments = outcome.appliedAdjustments ?? [];
    if (adjustments.length === 0) {
      return '';
    }

    return ` Modifiche applicate: ${adjustments.length}.`;
  }

  function getInitialEndTime(dateValue: string, startTimeValue: string): string {
    const endDateTime = addMinutesToDateTime(`${dateValue}T${startTimeValue}`, standardVisitDurationMinutes);
    return endDateTime.slice(11, 16);
  }

  function formatDateTimeForToast(value: string): string {
    return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)} ${value.slice(11, 16)}`;
  }

  function applyFoundSlotToAppointmentForm(params: {
    startDateTime: string;
    endDateTime: string;
    resetForCreate: boolean;
  }): void {
    appointmentForm = {
      pazienteId: params.resetForCreate ? 0 : appointmentForm.pazienteId,
      date: params.startDateTime.slice(0, 10),
      startTime: params.startDateTime.slice(11, 16),
      endTime: params.endDateTime.slice(11, 16),
      motivo: params.resetForCreate ? '' : appointmentForm.motivo
    };
  }

  async function handleFindFirstSlot(
    mode: FirstSlotSearchMode,
    source: 'toolbar' | 'modal',
    searchNext = false
  ): Promise<void> {
    if (!ensureVisitTimingSettingsConfigured()) {
      return;
    }

    if (!ambulatorioId || searchingFirstSlotMode) {
      return;
    }

    searchingFirstSlotMode = mode;
    try {
      const fromDateTime = searchNext
        ? (mode === 'urgent'
            ? (nextUrgentSearchCursor ?? undefined)
            : (nextQuarterHourSearchCursor ?? undefined))
        : undefined;
      const result =
        mode === 'urgent'
          ? await findFirstUrgentSlot({ ambulatorioId, fromDateTime })
          : await findFirstQuarterHourSlot({ ambulatorioId, fromDateTime });

      if (!result.found || !result.startDateTime || !result.endDateTime) {
        toastStore.show(
          'info',
          result.reasonIfNotFound || 'Nessuno slot disponibile trovato entro i prossimi 180 giorni.'
        );
        return;
      }

      const normalizedStart = normalizeAppuntamentoDateTimeInput(result.startDateTime);
      const normalizedEnd = normalizeAppuntamentoDateTimeInput(result.endDateTime);
      if (mode === 'urgent') {
        nextUrgentSearchCursor = normalizedEnd;
      } else {
        nextQuarterHourSearchCursor = normalizedEnd;
      }
      const resetForCreate = source === 'toolbar';
      applyFoundSlotToAppointmentForm({
        startDateTime: normalizedStart,
        endDateTime: normalizedEnd,
        resetForCreate
      });

      if (source === 'toolbar') {
        editingAppointment = null;
        showAppointmentModal = true;
      }

      const slotLabel =
        mode === 'urgent'
          ? (searchNext ? 'Slot urgente successivo' : 'Primo slot urgente')
          : (searchNext ? 'Slot disponibile successivo' : 'Primo slot disponibile');
      toastStore.show(
        'success',
        `${slotLabel}: ${formatDateTimeForToast(normalizedStart)} - ${normalizedEnd.slice(11, 16)}`
      );

      if (mode === 'urgent' && result.requiresAdjustmentHint) {
        toastStore.show(
          'info',
          'Lo slot urgente richiederà conferma degli aggiustamenti anti-overlap al salvataggio.'
        );
      }
    } catch (error) {
      toastStore.show('error', `Errore ricerca primo slot: ${getErrorMessage(error)}`);
    } finally {
      searchingFirstSlotMode = null;
    }
  }

  async function loadPatients(): Promise<void> {
    loadingPatients = true;
    try {
      if (!ambulatorioId) {
        patients = [];
        return;
      }
      patients = await getPazientiByAmbulatorio(ambulatorioId);
    } catch (error) {
      console.error('Errore caricamento pazienti:', error);
      toastStore.show('error', `Errore caricamento pazienti: ${getErrorMessage(error)}`);
    } finally {
      loadingPatients = false;
    }
  }

  async function loadOperatingSettings(): Promise<void> {
    if (!ambulatorioId) {
      operatingSettings = null;
      applyCalendarOperatingSettings(null);
      return;
    }

    try {
      operatingSettings = await getAmbulatorioOperatingSettingsById(ambulatorioId);
      applyCalendarOperatingSettings(operatingSettings);
    } catch (error) {
      console.error('Errore caricamento orari ambulatorio:', error);
      toastStore.show('error', `Errore caricamento orari ambulatorio: ${getErrorMessage(error)}`);
      operatingSettings = null;
      applyCalendarOperatingSettings(null);
    }
  }

  async function initializeAmbulatorioContext(): Promise<void> {
    await Promise.all([loadPatients(), loadOperatingSettings()]);
    if (currentRangeStart && currentRangeEndExclusive) {
      await reloadAppointmentsForCurrentRange();
    }
  }

  async function reloadAppointmentsForCurrentRange(): Promise<void> {
    if (!currentRangeStart || !currentRangeEndExclusive || !ambulatorioId) {
      loading = false;
      return;
    }

    try {
      const [items, counts] = await Promise.all([
        getAppuntamentiByRange({
          ambulatorioId,
          rangeStart: currentRangeStart,
          rangeEndExclusive: currentRangeEndExclusive
        }),
        getDailyAppointmentCountsByRange({
          ambulatorioId,
          rangeStart: currentRangeStart,
          rangeEndExclusive: currentRangeEndExclusive
        })
      ]);

      appuntamenti = items;
      calendarEvents = mapAppointmentsToEvents(items);
      dailyCounts = new Map(counts.map((row) => [row.date, Number(row.total || 0)]));
      daysWithAppointments = new Set(Array.from(dailyCounts.keys()));
      syncCalendarEvents(calendarEvents);
      refreshCalendarDecorations();
    } catch (error) {
      console.error('Errore caricamento appuntamenti:', error);
      toastStore.show('error', `Errore caricamento appuntamenti: ${getErrorMessage(error)}`);
    } finally {
      loading = false;
    }
  }

  async function handleDatesSet(arg: DatesSetArg): Promise<void> {
    currentView = normalizeCalendarView(arg.view.type);
    calendarTitle = arg.view.title;
    currentRangeStart = formatDateTime(arg.start);
    currentRangeEndExclusive = formatDateTime(arg.end);
    syncJumpDateFromCalendar();
    await reloadAppointmentsForCurrentRange();
  }

  function openCreateModal(startDate: Date, endDate?: Date): void {
    if (!ensureVisitTimingSettingsConfigured()) {
      return;
    }

    const nextDate = formatDateOnly(startDate);
    const nextStartTime = formatTimeOnly(startDate);
    const nextEndTime = endDate ? formatTimeOnly(endDate) : getInitialEndTime(nextDate, nextStartTime);

    appointmentForm = {
      pazienteId: 0,
      date: nextDate,
      startTime: nextStartTime,
      endTime: nextEndTime,
      motivo: ''
    };
    resetPatientModalState();
    editingAppointment = null;
    showAppointmentModal = true;
  }

  function openEditModal(appointment: Appuntamento): void {
    if (!ensureVisitTimingSettingsConfigured()) {
      return;
    }

    const normalizedStart = normalizeAppuntamentoDateTimeInput(appointment.data_ora_inizio);
    const normalizedEnd = normalizeAppuntamentoDateTimeInput(appointment.data_ora_fine);
    appointmentForm = {
      pazienteId: appointment.paziente_id,
      date: normalizedStart.slice(0, 10),
      startTime: normalizedStart.slice(11, 16),
      endTime: normalizedEnd.slice(11, 16),
      motivo: appointment.motivo || ''
    };
    resetPatientModalState();
    editingAppointment = appointment;
    showAppointmentModal = true;
  }

  function closeModal(): void {
    showAppointmentModal = false;
    resetPatientModalState();
    editingAppointment = null;
    deletingAppointment = false;
    savingAppointment = false;
    creatingQuickPatient = false;
    searchingFirstSlotMode = null;
  }

  async function createQuickPatientFromModal(): Promise<void> {
    if (!ambulatorioId || creatingQuickPatient) {
      return;
    }

    if (!validateQuickPatientForm()) {
      return;
    }

    const nome = quickPatientForm.nome.trim();
    const cognome = quickPatientForm.cognome.trim();
    const telefono = quickPatientForm.telefono.trim();

    creatingQuickPatient = true;

    try {
      const newPatientId = await createPazienteRapido({
        ambulatorio_id: ambulatorioId,
        nome,
        cognome,
        telefono
      });

      await loadPatients();
      selectPatientForAppointment(newPatientId, `${cognome} ${nome}`);
      patientModalTab = 'search';
      resetQuickPatientForm();
      resetQuickPatientErrors();
      toastStore.show('success', `Paziente ${cognome} ${nome} creato e selezionato`);
    } catch (error) {
      console.error('Errore creazione paziente rapido:', error);
      toastStore.show('error', `Errore creazione paziente: ${getErrorMessage(error)}`);
    } finally {
      creatingQuickPatient = false;
    }
  }

  function handleDateClick(arg: any): void {
    if (arg.view.type === 'dayGridMonth') {
      const api = getCalendarApi();
      if (!api) {
        return;
      }

      api.changeView('timeGridDay', arg.date);
      currentView = 'timeGridDay';
      syncJumpDateFromCalendar();
      return;
    }

    openCreateModal(arg.date);
  }

  function handleSelect(arg: any): void {
    if (arg.view.type === 'dayGridMonth') {
      return;
    }

    openCreateModal(arg.start, arg.end);
    const api = getCalendarApi();
    api?.unselect();
  }

  function handleEventClick(arg: EventClickArg): void {
    const appointmentId = Number.parseInt(arg.event.id, 10);
    if (!Number.isInteger(appointmentId)) {
      return;
    }

    const appointment = appuntamenti.find((item) => item.id === appointmentId);
    if (!appointment) {
      return;
    }

    openEditModal(appointment);
  }

  async function handleEventDrop(arg: EventDropArg): Promise<void> {
    if (!ensureVisitTimingSettingsConfigured()) {
      arg.revert();
      return;
    }

    const appointmentId = Number.parseInt(arg.event.id, 10);
    const newStart = arg.event.start;
    const newEnd = arg.event.end;

    if (!Number.isInteger(appointmentId) || !newStart || !newEnd) {
      arg.revert();
      return;
    }

    try {
      const outcome = await executeWithConfirmations((options) =>
        updateAppuntamento(
          {
            id: appointmentId,
            data_ora_inizio: formatDateTime(newStart),
            data_ora_fine: formatDateTime(newEnd)
          },
          options
        )
      );

      if (!outcome) {
        arg.revert();
        toastStore.show('info', 'Spostamento appuntamento annullato');
        return;
      }

      if (!outcome.saved) {
        arg.revert();
        toastStore.show('error', buildRequirementsMessage(outcome));
        return;
      }

      toastStore.show('success', `Appuntamento aggiornato.${formatAppliedAdjustments(outcome)}`);
      await reloadAppointmentsForCurrentRange();
    } catch (error) {
      console.error('Errore spostamento appuntamento:', error);
      arg.revert();
      toastStore.show('error', `Impossibile spostare appuntamento: ${getErrorMessage(error)}`);
    }
  }

  async function handleEventResize(arg: any): Promise<void> {
    if (!ensureVisitTimingSettingsConfigured()) {
      arg.revert();
      return;
    }

    const appointmentId = Number.parseInt(arg.event.id, 10);
    const newStart = arg.event.start;
    const newEnd = arg.event.end;

    if (!Number.isInteger(appointmentId) || !newStart || !newEnd) {
      arg.revert();
      return;
    }

    try {
      const outcome = await executeWithConfirmations((options) =>
        updateAppuntamento(
          {
            id: appointmentId,
            data_ora_inizio: formatDateTime(newStart),
            data_ora_fine: formatDateTime(newEnd)
          },
          options
        )
      );

      if (!outcome) {
        arg.revert();
        toastStore.show('info', 'Ridimensionamento appuntamento annullato');
        return;
      }

      if (!outcome.saved) {
        arg.revert();
        toastStore.show('error', buildRequirementsMessage(outcome));
        return;
      }

      toastStore.show('success', `Appuntamento aggiornato.${formatAppliedAdjustments(outcome)}`);
      await reloadAppointmentsForCurrentRange();
    } catch (error) {
      console.error('Errore ridimensionamento appuntamento:', error);
      arg.revert();
      toastStore.show('error', `Impossibile aggiornare durata appuntamento: ${getErrorMessage(error)}`);
    }
  }

  function ensureAppointmentFormDateTime(): { startDateTime: string; endDateTime: string } {
    if (!appointmentForm.date || !appointmentForm.startTime || !appointmentForm.endTime) {
      throw new Error('Inserisci data, orario di inizio e orario di fine');
    }

    const startDateTime = `${appointmentForm.date}T${appointmentForm.startTime}`;
    const endDateTime = `${appointmentForm.date}T${appointmentForm.endTime}`;

    if (normalizeAppuntamentoDateTimeInput(endDateTime) <= normalizeAppuntamentoDateTimeInput(startDateTime)) {
      throw new Error('L’orario di fine deve essere successivo all’orario di inizio');
    }

    return {
      startDateTime,
      endDateTime
    };
  }

  async function saveAppointment(): Promise<void> {
    if (!ensureVisitTimingSettingsConfigured()) {
      return;
    }

    const matchedPatientByLabel = findPatientByDisplayLabel(patientSearchTerm);
    const resolvedPatientId = appointmentForm.pazienteId || matchedPatientByLabel?.id || 0;

    if (!resolvedPatientId) {
      toastStore.show('error', 'Seleziona un paziente');
      return;
    }

    if (appointmentForm.pazienteId !== resolvedPatientId) {
      appointmentForm = {
        ...appointmentForm,
        pazienteId: resolvedPatientId
      };
    }

    let startDateTime = '';
    let endDateTime = '';

    try {
      const range = ensureAppointmentFormDateTime();
      startDateTime = range.startDateTime;
      endDateTime = range.endDateTime;
    } catch (error) {
      toastStore.show('error', getErrorMessage(error));
      return;
    }

    savingAppointment = true;

    try {
      const editing = editingAppointment;
      if (isEditing && editing) {
        const outcome = await executeWithConfirmations((options) =>
          updateAppuntamento(
            {
              id: editing.id,
              paziente_id: isFollowUpAppointment ? undefined : resolvedPatientId,
              data_ora_inizio: startDateTime,
              data_ora_fine: endDateTime,
              motivo: appointmentForm.motivo
            },
            options
          )
        );

        if (!outcome) {
          toastStore.show('info', 'Aggiornamento appuntamento annullato');
          return;
        }

        if (!outcome.saved) {
          toastStore.show('error', buildRequirementsMessage(outcome));
          return;
        }

        toastStore.show('success', `Appuntamento aggiornato.${formatAppliedAdjustments(outcome)}`);
      } else {
        const outcome = await executeWithConfirmations((options) =>
          createAppuntamentoManuale(
            {
              ambulatorio_id: ambulatorioId,
              paziente_id: resolvedPatientId,
              data_ora_inizio: startDateTime,
              data_ora_fine: endDateTime,
              motivo: appointmentForm.motivo
            },
            options
          )
        );

        if (!outcome) {
          toastStore.show('info', 'Creazione appuntamento annullata');
          return;
        }

        if (!outcome.saved) {
          toastStore.show('error', buildRequirementsMessage(outcome));
          return;
        }

        toastStore.show('success', `Appuntamento creato.${formatAppliedAdjustments(outcome)}`);
      }

      closeModal();
      await reloadAppointmentsForCurrentRange();
    } catch (error) {
      console.error('Errore salvataggio appuntamento:', error);
      toastStore.show('error', `Errore salvataggio appuntamento: ${getErrorMessage(error)}`);
    } finally {
      savingAppointment = false;
    }
  }

  async function removeAppointment(): Promise<void> {
    if (!editingAppointment) {
      return;
    }

    deletingAppointment = true;
    try {
      await deleteAppuntamento(editingAppointment.id);
      toastStore.show('success', 'Appuntamento eliminato');
      closeModal();
      await reloadAppointmentsForCurrentRange();
    } catch (error) {
      console.error('Errore eliminazione appuntamento:', error);
      toastStore.show('error', `Errore eliminazione appuntamento: ${getErrorMessage(error)}`);
    } finally {
      deletingAppointment = false;
    }
  }

  function changeView(view: CalendarView): void {
    const api = getCalendarApi();
    if (!api) {
      return;
    }

    api.changeView(view);
    currentView = view;
    syncJumpDateFromCalendar();
  }

  function navigatePrev(): void {
    const api = getCalendarApi();
    if (!api) {
      return;
    }

    api.prev();
    syncJumpDateFromCalendar();
  }

  function navigateNext(): void {
    const api = getCalendarApi();
    if (!api) {
      return;
    }

    api.next();
    syncJumpDateFromCalendar();
  }

  function navigateToday(): void {
    const api = getCalendarApi();
    if (!api) {
      return;
    }

    api.today();
    syncJumpDateFromCalendar();
  }

  function jumpToDate(): void {
    if (!jumpDate.trim()) {
      return;
    }

    const api = getCalendarApi();
    if (!api) {
      return;
    }

    api.gotoDate(`${jumpDate}T00:00`);
  }

  $: calendarOptions = {
    plugins: calendarPlugins,
    locales: [itLocale],
    locale: 'it',
    initialView: 'dayGridMonth',
    allDaySlot: false,
    nowIndicator: true,
    height: 'auto',
    contentHeight: 'auto',
    expandRows: false,
    editable: true,
    selectable: true,
    selectMirror: false,
    eventDurationEditable: true,
    eventResizableFromStart: true,
    slotDuration: calendarSlotDuration,
    slotLabelInterval: calendarSlotDuration,
    slotLabelFormat: {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    },
    eventTimeFormat: {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    },
    slotMinTime: calendarSlotMinTime,
    slotMaxTime: calendarSlotMaxTime,
    businessHours: calendarBusinessHours,
    headerToolbar: false,
    dayMaxEvents: true,
    dayCellClassNames,
    dayCellDidMount,
    dayHeaderDidMount,
    dayHeaderFormat: {
      weekday: 'short'
    },
    datesSet: handleDatesSet,
    dateClick: handleDateClick,
    select: handleSelect,
    eventClick: handleEventClick,
    eventDrop: handleEventDrop,
    eventResize: handleEventResize,
    views: {
      dayGridMonth: {
        fixedWeekCount: true,
        dayMaxEvents: 3,
        moreLinkContent: () => '...',
        titleFormat: {
          month: 'long',
          year: 'numeric'
        }
      },
      timeGridDay: {
        dayHeaderFormat: {
          weekday: 'long',
          day: '2-digit',
          month: 'long',
          year: 'numeric'
        },
        titleFormat: {
          weekday: 'long',
          day: '2-digit',
          month: 'long',
          year: 'numeric'
        }
      }
    },
    events: []
  };

  onMount(() => {
    void initializeAmbulatorioContext();
  });
</script>

<div class="appuntamenti-page">
  <PageHeader
    title="Calendario"
    subtitle="Gestisci il calendario appuntamenti."
    showLogo={$sidebarCollapsedStore}
    onBack={() => goto(`/ambulatori/${ambulatorioId}`)}
  >
    <div slot="actions" class="header-actions">
      <button type="button" class="btn-icon-text" on:click={() => openCreateModal(new Date())}>
        <span class="icon">
          <Icon name="calendar-plus" size={22} />
        </span>
        <span class="text">Nuovo App.</span>
      </button>
      {#if currentView === 'timeGridDay'}
        <button
          type="button"
          class="btn-icon-text btn-print-day"
          on:click={printDailyAgenda}
          disabled={printingDailyAgenda || loading}
        >
          <span class="icon">
            <Icon name="file-text" size={20} />
          </span>
          <span class="text">{printingDailyAgenda ? 'Stampa...' : 'Stampa'}</span>
        </button>
      {/if}
    </div>
  </PageHeader>

  <Card>
    <div class="calendar-toolbar">
      <div class="calendar-toolbar-top">
        <div class="toolbar-title-nav">
          <button type="button" class="btn-nav-arrow" on:click={navigatePrev} aria-label="Periodo precedente">
            <Icon name="chevron-left" size={18} />
          </button>
          <div class="toolbar-title">{calendarTitle || 'Calendario'}</div>
          <button type="button" class="btn-secondary btn-today-inline" on:click={navigateToday}>Oggi</button>
          <button type="button" class="btn-nav-arrow" on:click={navigateNext} aria-label="Periodo successivo">
            <Icon name="chevron-right" size={18} />
          </button>
        </div>

        <div class="toolbar-controls">
          <div class="view-toggle" role="group" aria-label="Seleziona visualizzazione calendario">
            <button
              type="button"
              class="toggle-btn"
              class:active={currentView === 'dayGridMonth'}
              on:click={() => changeView('dayGridMonth')}
            >
              Mese
            </button>
            <button
              type="button"
              class="toggle-btn"
              class:active={currentView === 'timeGridDay'}
              on:click={() => changeView('timeGridDay')}
            >
              Giorno
            </button>
          </div>

          <div class="toolbar-jump">
            <input type="date" bind:value={jumpDate} />
            <button type="button" class="btn-secondary btn-jump" on:click={jumpToDate}>Vai</button>
          </div>
        </div>
      </div>

      <div class="toolbar-slot-actions">
        <button
          type="button"
          class="btn-secondary slot-btn-urgent"
          on:click={() => handleFindFirstSlot('urgent', 'toolbar')}
          disabled={Boolean(searchingFirstSlotMode) || !ambulatorioId}
        >
          {searchingFirstSlotMode === 'urgent' ? 'Ricerca urgente...' : 'Primo slot urgente'}
        </button>
        <button
          type="button"
          class="btn-secondary slot-btn-available"
          on:click={() => handleFindFirstSlot('quarter_hour', 'toolbar')}
          disabled={Boolean(searchingFirstSlotMode) || !ambulatorioId}
        >
          {searchingFirstSlotMode === 'quarter_hour'
            ? 'Ricerca disponibile...'
            : 'Primo slot disponibile'}
        </button>
      </div>
    </div>

    <div class="calendar-wrapper">
      {#if loading}
        <div class="loading-overlay">Caricamento calendario...</div>
      {/if}
      <FullCalendar bind:this={calendarRef} options={calendarOptions} />
    </div>

    <div class="legend">
      <span class="legend-item">
        <span class="legend-dot manual"></span>
        Manuale
      </span>
      <span class="legend-item">
        <span class="legend-dot followup"></span>
        Da follow-up visita
      </span>
      <span class="legend-note">Vista corrente: {viewLabels[currentView]} - Visite giorno selezionato: {currentDayCount}</span>
    </div>
  </Card>
</div>

<Modal bind:open={showAppointmentModal} title={modalTitle} size="md" closeOnBackdropClick={false}>
  <div class="modal-form">
    <div class="form-group">
      {#if !isFollowUpAppointment}
        <div class="patient-section-header">
          <div class="patient-picker-tabs" role="tablist" aria-label="Seleziona modalità paziente">
            <button
              type="button"
              role="tab"
              class="patient-picker-tab"
              class:active={patientModalTab === 'search'}
              aria-selected={patientModalTab === 'search'}
              on:click={() => switchPatientModalTab('search')}
              disabled={creatingQuickPatient || savingAppointment || deletingAppointment}
            >
              Cerca paziente
            </button>
            <button
              type="button"
              role="tab"
              class="patient-picker-tab"
              class:active={patientModalTab === 'quick_create'}
              aria-selected={patientModalTab === 'quick_create'}
              on:click={() => switchPatientModalTab('quick_create')}
              disabled={creatingQuickPatient || savingAppointment || deletingAppointment}
            >
              Nuovo paziente
            </button>
          </div>
        </div>
      {/if}

      {#if isFollowUpAppointment}
        <div class="patient-readonly-card">
          {#if selectedAppointmentPatient}
            <strong>{selectedAppointmentPatient.cognome} {selectedAppointmentPatient.nome}</strong>
            <span>Data di nascita: {formatBirthDateLabel(selectedAppointmentPatient.data_nascita) || '-'}</span>
          {:else}
            <span>Paziente associato alla visita origine</span>
          {/if}
        </div>
        <small class="help-text">
          Appuntamento da follow-up: il paziente della visita origine non è modificabile.
        </small>
      {:else}
        {#if patientModalTab === 'search'}
          <div class="patient-search-panel">
            <div class="patient-search-autocomplete">
              <div class="form-group">
                <label for="appointment_patient_search">Cerca paziente</label>
                <div class="patient-search-input-wrap">
                  <input
                    id="appointment_patient_search"
                    type="text"
                    bind:value={patientSearchTerm}
                    placeholder="Cerca per cognome o nome..."
                    disabled={loadingPatients || creatingQuickPatient}
                    on:input={handlePatientSearchInput}
                    on:change={handlePatientSearchInput}
                    on:focus={handlePatientSearchFocus}
                    on:blur={handlePatientSearchBlur}
                    class:has-selection={showSelectedPatientCheck}
                    autocomplete="off"
                  />
                  {#if showSelectedPatientCheck}
                    <span class="patient-selected-check" title="Paziente selezionato" aria-label="Paziente selezionato">
                      ✓
                    </span>
                  {/if}
                </div>
              </div>

              {#if showPatientSearchSuggestions}
                {#if loadingPatients}
                  <div class="patient-search-empty patient-search-overlay">Caricamento pazienti...</div>
                {:else if filteredPatientsForModal.length === 0}
                  <div class="patient-search-empty patient-search-overlay">Nessun paziente trovato</div>
                {:else}
                  <div class="patient-search-list patient-search-overlay" role="listbox" aria-label="Risultati ricerca pazienti">
                    {#each filteredPatientsForModal as patient}
                      <button
                        type="button"
                        role="option"
                        aria-selected={appointmentForm.pazienteId === patient.id}
                        class="patient-search-item"
                        class:selected={appointmentForm.pazienteId === patient.id}
                        on:mousedown|preventDefault={() => handlePatientSearchOptionSelect(patient)}
                      >
                        {patient.cognome} {patient.nome} ({formatBirthDateLabel(patient.data_nascita) || '-'})
                      </button>
                    {/each}
                  </div>
                {/if}
              {/if}
            </div>

          </div>
        {:else}
          <div class="quick-patient-panel">
            <div class="form-row">
              <div class="form-group">
                <label for="quick_patient_nome">Nome *</label>
                <input
                  id="quick_patient_nome"
                  type="text"
                  bind:value={quickPatientForm.nome}
                  disabled={creatingQuickPatient}
                  on:input={() => clearQuickPatientError('nome')}
                />
                {#if quickPatientErrors.nome}
                  <small class="field-error">{quickPatientErrors.nome}</small>
                {/if}
              </div>
              <div class="form-group">
                <label for="quick_patient_cognome">Cognome *</label>
                <input
                  id="quick_patient_cognome"
                  type="text"
                  bind:value={quickPatientForm.cognome}
                  disabled={creatingQuickPatient}
                  on:input={() => clearQuickPatientError('cognome')}
                />
                {#if quickPatientErrors.cognome}
                  <small class="field-error">{quickPatientErrors.cognome}</small>
                {/if}
              </div>
            </div>

            <div class="form-group">
              <label for="quick_patient_telefono">Telefono *</label>
              <input
                id="quick_patient_telefono"
                type="tel"
                bind:value={quickPatientForm.telefono}
                disabled={creatingQuickPatient}
                on:input={() => clearQuickPatientError('telefono')}
              />
              {#if quickPatientErrors.telefono}
                <small class="field-error">{quickPatientErrors.telefono}</small>
              {/if}
            </div>

            <div class="quick-patient-actions">
              <button
                type="button"
                class="btn-primary"
                on:click={createQuickPatientFromModal}
                disabled={creatingQuickPatient || savingAppointment || deletingAppointment}
              >
                {creatingQuickPatient ? 'Creazione paziente...' : 'Crea paziente e seleziona'}
              </button>
            </div>
          </div>
        {/if}
      {/if}
    </div>

    <div class="slot-search-actions">
      <button
        type="button"
        class="btn-secondary"
        on:click={() => handleFindFirstSlot('urgent', 'modal')}
        disabled={Boolean(searchingFirstSlotMode) || savingAppointment || deletingAppointment || !ambulatorioId}
      >
        {searchingFirstSlotMode === 'urgent' ? 'Ricerca urgente...' : 'Primo slot urgente'}
      </button>
      <button
        type="button"
        class="btn-secondary"
        on:click={() => handleFindFirstSlot('urgent', 'modal', true)}
        disabled={Boolean(searchingFirstSlotMode) || savingAppointment || deletingAppointment || !ambulatorioId || !nextUrgentSearchCursor}
      >
        Urgente successivo
      </button>
      <button
        type="button"
        class="btn-secondary"
        on:click={() => handleFindFirstSlot('quarter_hour', 'modal')}
        disabled={Boolean(searchingFirstSlotMode) || savingAppointment || deletingAppointment || !ambulatorioId}
      >
        {searchingFirstSlotMode === 'quarter_hour'
          ? 'Ricerca disponibile...'
          : 'Primo slot disponibile'}
      </button>
      <button
        type="button"
        class="btn-secondary"
        on:click={() => handleFindFirstSlot('quarter_hour', 'modal', true)}
        disabled={Boolean(searchingFirstSlotMode) || savingAppointment || deletingAppointment || !ambulatorioId || !nextQuarterHourSearchCursor}
      >
        Disponibile successivo
      </button>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label for="appointment_date">Data *</label>
        <input id="appointment_date" type="date" bind:value={appointmentForm.date} />
      </div>
      <div class="form-group">
        <label for="appointment_start_time">Ora inizio *</label>
        <input id="appointment_start_time" type="time" step="300" bind:value={appointmentForm.startTime} />
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label for="appointment_end_time">Ora fine *</label>
        <input id="appointment_end_time" type="time" step="300" bind:value={appointmentForm.endTime} />
      </div>
      <div class="form-group">
        <label for="appointment_reason">Motivo</label>
        <input id="appointment_reason" type="text" bind:value={appointmentForm.motivo} />
      </div>
    </div>
  </div>

  <svelte:fragment slot="footer">
    <div class="modal-actions">
      {#if isEditing}
        <button type="button" class="btn-danger" on:click={removeAppointment} disabled={deletingAppointment || savingAppointment}>
          {deletingAppointment ? 'Eliminazione...' : 'Elimina'}
        </button>
      {/if}

      <div class="modal-actions-right">
        <button type="button" class="btn-secondary" on:click={closeModal} disabled={savingAppointment || deletingAppointment}>
          Annulla
        </button>
        <button type="button" class="btn-primary" on:click={saveAppointment} disabled={savingAppointment || deletingAppointment}>
          {savingAppointment ? 'Salvataggio...' : 'Salva'}
        </button>
      </div>
    </div>
  </svelte:fragment>
</Modal>

<style>
  :global(.fc) {
    --fc-border-color: var(--color-border);
    --fc-button-bg-color: var(--color-primary);
    --fc-button-border-color: var(--color-primary);
    --fc-button-hover-bg-color: var(--color-primary-dark);
    --fc-button-hover-border-color: var(--color-primary-dark);
    --fc-button-active-bg-color: var(--color-primary-dark);
    --fc-button-active-border-color: var(--color-primary-dark);
    --fc-event-border-color: transparent;
    --fc-event-text-color: var(--color-text);
    --fc-page-bg-color: var(--color-bg-primary);
    --fc-today-bg-color: color-mix(in srgb, var(--color-primary) 10%, transparent);
  }

  :global(.fc .fc-toolbar-title) {
    font-size: var(--text-lg);
    font-weight: 600;
  }

  :global(.fc .fc-col-header-cell-cushion) {
    color: var(--color-text);
    font-weight: 600;
  }

  :global(.fc .fc-daygrid-day-number) {
    color: var(--color-text);
  }

  :global(.fc .fc-timegrid-slot-label-cushion) {
    color: var(--color-text-secondary);
  }

  :global(.fc .fc-day-has-appointments) {
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  }

  :global(.fc .fc-day-non-working) {
    background: color-mix(in srgb, var(--color-bg-secondary) 60%, transparent);
  }

  :global(.fc .fc-daygrid-day-top) {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  /* In vista mese le celle restano ad altezza fissa anche con più appuntamenti */
  :global(.calendar-wrapper .fc .fc-daygrid-day-frame) {
    min-height: 118px;
    max-height: 118px;
  }

  :global(.fc .day-count-badge) {
    min-width: 18px;
    height: 18px;
    padding: 0 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary) 82%, #ffffff);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  :global(.fc .fc-col-header-cell-cushion) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  :global(.fc .fc-day-count-pill) {
    min-width: 18px;
    height: 18px;
    padding: 0 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary) 82%, #ffffff);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  :global(.calendar-wrapper .fc .fc-dayGridMonth-view .fc-daygrid-more-link) {
    position: relative;
    top: -2px;
    font-size: calc(var(--text-sm) + 1px);
    font-weight: 800;
    line-height: 1;
  }

  :global(.fc .calendar-event) {
    border-radius: var(--radius-sm);
    padding: 2px 4px;
    font-size: var(--text-xs);
  }

  /* Vista settimana/giorno: slot un po' più alti per leggibilità */
  :global(.calendar-wrapper .fc .fc-timegrid-slot) {
    height: 2.2rem;
  }

  /* Vista settimana/giorno: box compatto, testo su una sola riga e centrato verticalmente */
  :global(.calendar-wrapper .fc .fc-timeGridWeek-view .calendar-event),
  :global(.calendar-wrapper .fc .fc-timeGridDay-view .calendar-event) {
    padding: 1px 3px;
    line-height: 1.2;
    text-align: left;
  }

  :global(.calendar-wrapper .fc .fc-timeGridWeek-view .calendar-event .fc-event-main),
  :global(.calendar-wrapper .fc .fc-timeGridDay-view .calendar-event .fc-event-main) {
    padding: 0;
  }

  :global(.calendar-wrapper .fc .fc-timeGridWeek-view .calendar-event .fc-event-main-frame),
  :global(.calendar-wrapper .fc .fc-timeGridDay-view .calendar-event .fc-event-main-frame) {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    gap: 4px;
    height: 100%;
    min-width: 0;
    white-space: nowrap;
    text-align: left;
  }

  /* Anche gli eventi con durata breve restano su una sola riga e a sinistra */
  :global(.calendar-wrapper .fc .fc-timeGridWeek-view .calendar-event.fc-timegrid-event-short .fc-event-main-frame),
  :global(.calendar-wrapper .fc .fc-timeGridDay-view .calendar-event.fc-timegrid-event-short .fc-event-main-frame) {
    flex-direction: row !important;
    align-items: center;
    justify-content: flex-start;
    overflow: hidden;
    white-space: nowrap;
  }

  :global(.calendar-wrapper .fc .fc-timeGridWeek-view .calendar-event .fc-event-time),
  :global(.calendar-wrapper .fc .fc-timeGridDay-view .calendar-event .fc-event-time) {
    flex: 0 0 auto;
    font-size: var(--text-sm);
    font-weight: 700;
    line-height: 1.2;
    text-align: left;
  }

  :global(.calendar-wrapper .fc .fc-timeGridWeek-view .calendar-event .fc-event-title-container),
  :global(.calendar-wrapper .fc .fc-timeGridDay-view .calendar-event .fc-event-title-container) {
    flex: 1 1 auto;
    min-width: 0;
  }

  :global(.calendar-wrapper .fc .fc-timeGridWeek-view .calendar-event .fc-event-title),
  :global(.calendar-wrapper .fc .fc-timeGridDay-view .calendar-event .fc-event-title) {
    font-size: var(--text-sm);
    font-weight: 700;
    line-height: 1.2;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  :global(.fc .calendar-event-manual) {
    background: color-mix(in srgb, var(--color-primary) 20%, var(--color-bg-secondary));
  }

  :global(.fc .calendar-event-followup) {
    background: color-mix(in srgb, var(--color-success) 22%, var(--color-bg-secondary));
  }

  .appuntamenti-page {
    padding: var(--space-6);
    max-width: 1500px;
    margin: 0 auto;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .calendar-toolbar {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .calendar-toolbar-top {
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
  }

  .toolbar-title-nav,
  .toolbar-controls,
  .toolbar-jump,
  .toolbar-slot-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .toolbar-controls {
    margin-left: auto;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .toolbar-title-nav {
    flex-wrap: wrap;
  }

  .toolbar-slot-actions {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .toolbar-title {
    font-size: var(--text-lg);
    font-weight: 700;
    color: var(--color-text);
    text-transform: capitalize;
  }

  .btn-nav-arrow {
    width: 34px;
    height: 34px;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-bg-primary);
    color: var(--color-text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .btn-nav-arrow:hover:not(:disabled) {
    background: var(--color-bg-secondary);
    border-color: var(--color-text-tertiary);
  }

  .btn-nav-arrow:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-today-inline {
    height: 34px;
    padding: 0 var(--space-4);
  }

  .view-toggle {
    display: inline-flex;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--color-bg-primary);
  }

  .toggle-btn {
    border: 0;
    border-right: 1px solid var(--color-border);
    border-radius: 0;
    padding: 8px 12px;
    background: transparent;
    color: var(--color-text);
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .toggle-btn:last-child {
    border-right: 0;
  }

  .toggle-btn:hover:not(.active):not(:disabled) {
    background: var(--color-bg-secondary);
  }

  .toggle-btn.active {
    background: var(--color-primary);
    color: #fff;
  }

  .toolbar-jump input {
    min-width: 170px;
    height: 34px;
    padding: var(--space-1) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-bg);
    font-family: var(--font-sans);
    font-size: var(--text-base);
    color: var(--color-text);
    transition: all var(--transition-fast);
    box-sizing: border-box;
  }

  .toolbar-jump input:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px rgba(30, 58, 138, 0.1);
  }

  .toolbar-jump input:disabled {
    background-color: var(--color-bg-secondary);
    cursor: not-allowed;
    opacity: 0.6;
  }

  .btn-jump {
    height: 34px;
  }

  .btn-print-day {
    height: 34px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: color-mix(in srgb, var(--color-primary) 12%, var(--color-bg-primary));
    color: color-mix(in srgb, var(--color-primary) 88%, var(--color-text));
    border-color: color-mix(in srgb, var(--color-primary) 36%, transparent);
  }

  .btn-print-day:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-primary) 20%, var(--color-bg-primary));
    border-color: color-mix(in srgb, var(--color-primary) 48%, transparent);
  }

  .slot-btn-urgent {
    background: color-mix(in srgb, var(--color-error) 12%, var(--color-bg-primary));
    color: color-mix(in srgb, var(--color-error) 86%, var(--color-text));
    border-color: color-mix(in srgb, var(--color-error) 36%, transparent);
  }

  .slot-btn-urgent:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-error) 20%, var(--color-bg-primary));
    border-color: color-mix(in srgb, var(--color-error) 48%, transparent);
  }

  .slot-btn-available {
    background: color-mix(in srgb, var(--color-success) 14%, var(--color-bg-primary));
    color: color-mix(in srgb, var(--color-success) 88%, var(--color-text));
    border-color: color-mix(in srgb, var(--color-success) 36%, transparent);
  }

  .slot-btn-available:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-success) 22%, var(--color-bg-primary));
    border-color: color-mix(in srgb, var(--color-success) 48%, transparent);
  }

  .btn-primary,
  .btn-secondary,
  .btn-danger {
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    padding: 8px 12px;
    cursor: pointer;
    font-size: var(--text-sm);
    transition: opacity 0.2s;
  }

  .btn-primary {
    background: var(--color-primary);
    color: #fff;
    border-color: var(--color-primary);
  }

  .btn-secondary {
    background: var(--color-bg-primary);
    color: var(--color-text);
    border-color: var(--color-border);
  }

  .btn-danger {
    background: color-mix(in srgb, var(--color-error) 14%, var(--color-bg-primary));
    color: var(--color-error);
    border-color: color-mix(in srgb, var(--color-error) 40%, transparent);
  }

  .btn-primary:disabled,
  .btn-secondary:disabled,
  .btn-danger:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .calendar-wrapper {
    position: relative;
    overflow-x: auto;
    overflow-y: visible;
  }

  :global(.calendar-wrapper .fc .fc-scroller) {
    overflow-y: auto !important;
  }

  .loading-overlay {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--color-bg-primary) 85%, transparent);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    backdrop-filter: blur(1px);
  }

  .legend {
    margin-top: var(--space-3);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 999px;
  }

  .legend-dot.manual {
    background: color-mix(in srgb, var(--color-primary) 50%, #ffffff);
  }

  .legend-dot.followup {
    background: color-mix(in srgb, var(--color-success) 60%, #ffffff);
  }

  .legend-note {
    margin-left: auto;
    font-style: italic;
  }

  .modal-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .slot-search-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .form-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .form-group label {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text);
  }

  .form-group input {
    width: 100%;
    height: 34px;
    padding: var(--space-1) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-bg);
    font-size: var(--text-base);
    font-family: var(--font-sans);
    color: var(--color-text);
    transition: all var(--transition-fast);
    box-sizing: border-box;
  }

  .form-group input:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px rgba(30, 58, 138, 0.1);
  }

  .form-group input:disabled {
    background-color: var(--color-bg-secondary);
    cursor: not-allowed;
    opacity: 0.6;
  }

  .help-text {
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
  }

  .patient-section-header {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .patient-picker-tabs {
    display: inline-flex;
    align-items: stretch;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--color-bg-primary);
  }

  .patient-picker-tab {
    border: 0;
    border-right: 1px solid var(--color-border);
    border-radius: 0;
    padding: 8px 12px;
    background: transparent;
    color: var(--color-text);
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition-fast);
    white-space: nowrap;
  }

  .patient-picker-tab:last-child {
    border-right: 0;
  }

  .patient-picker-tab:hover:not(:disabled):not(.active) {
    background: var(--color-bg-secondary);
  }

  .patient-picker-tab.active {
    background: var(--color-primary);
    color: #fff;
  }

  .patient-picker-tab:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .patient-readonly-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-bg-secondary) 45%, var(--color-bg-primary));
    color: var(--color-text);
  }

  .patient-readonly-card strong {
    font-size: var(--text-sm);
    font-weight: 700;
  }

  .patient-readonly-card span {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .patient-search-panel {
    margin-top: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .patient-search-autocomplete {
    position: relative;
  }

  .patient-search-input-wrap {
    position: relative;
  }

  .patient-search-input-wrap input.has-selection {
    padding-right: 2.2rem;
  }

  .patient-selected-check {
    position: absolute;
    top: 50%;
    right: 10px;
    transform: translateY(-50%);
    color: var(--color-success);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 800;
    line-height: 1;
    pointer-events: none;
  }

  .patient-search-overlay {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 40;
    background: var(--color-bg) !important;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    opacity: 1;
  }

  .patient-search-list {
    display: flex;
    flex-direction: column;
    max-height: 220px;
    overflow-y: auto;
    border-radius: var(--radius-md);
    background: var(--color-bg);
  }

  .patient-search-item {
    border: 0;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    text-align: left;
    padding: 10px 12px;
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer !important;
    transition: background-color var(--transition-fast);
    -webkit-user-select: none;
    user-select: none;
  }

  .patient-search-item:last-child {
    border-bottom: 0;
  }

  .patient-search-item:hover {
    background: color-mix(in srgb, var(--color-primary) 10%, var(--color-bg));
  }

  .patient-search-item.selected {
    background: color-mix(in srgb, var(--color-primary) 14%, var(--color-bg));
  }

  .patient-search-empty {
    padding: 10px 12px;
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    background: var(--color-bg);
  }

  .quick-patient-panel {
    margin-top: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-bg-secondary) 45%, var(--color-bg-primary));
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .quick-patient-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .field-error {
    color: var(--color-error);
    font-size: var(--text-xs);
  }

  .modal-actions {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
  }

  .modal-actions-right {
    margin-left: auto;
    display: flex;
    gap: var(--space-2);
  }

  @media (max-width: 900px) {
    .appuntamenti-page {
      padding: var(--space-4);
    }

    :global(.calendar-wrapper .fc .fc-daygrid-day-frame) {
      min-height: 96px;
      max-height: 96px;
    }

    .form-row {
      grid-template-columns: 1fr;
    }

    .calendar-toolbar-top {
      align-items: flex-start;
    }

    .toolbar-controls {
      margin-left: 0;
      width: 100%;
      justify-content: flex-start;
    }

    .toolbar-jump {
      width: 100%;
    }

    .toolbar-jump input {
      min-width: 0;
      width: 100%;
    }

    .legend-note {
      width: 100%;
      margin-left: 0;
    }
  }
</style>
