<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { ambulatorioStore } from '$lib/stores/ambulatorio';
  import { getAllPazienti } from '$lib/db/pazienti';
  import { getFattoriRischioCVByVisitaId } from '$lib/db/fattori-rischio-cv';
  import { previewAppuntamentoWrite } from '$lib/db/appuntamenti';
  import { getPreviousEsamiEmaticiByPaziente } from '$lib/db/visite';
  import {
    isBlockVisibleForAmbulatorio,
    isScaAmbulatorio
  } from '$lib/configs/visit-blocks-config';
  import type {
    AppuntamentoWriteOptions,
    AppuntamentoWriteRequirements,
    DiabeteTipo,
    Paziente,
    PreviousEsamiEmaticiMap,
    Visita
  } from '$lib/db/types';
  import {
    createEmptyEsamiEmatici,
    createEmptyFHAssessment,
    createEmptyFirmeVisita,
    createEmptyPianificazioneFollowUp,
    createEmptyTerapiaIpolipemizzante,
    createEmptyValutazioneRischioCV,
    isValutazioneRischioCVEqual,
    normalizeValutazioneRischioCV,
    parseEsamiEmatici,
    parseFHAssessment,
    parseFirmeVisita,
    parsePianificazioneFollowUp,
    parseTerapiaIpolipemizzante,
    parseValutazioneRischioCV,
    serializeEsamiEmatici,
    serializeFirmeVisita,
    serializeFHAssessment,
    serializePianificazioneFollowUp,
    serializeTerapiaIpolipemizzante,
    serializeValutazioneRischioCV,
    validateFHAssessment,
    validateTerapiaIpolipemizzante
  } from '$lib/utils/visit-clinical';
  import Conclusioni from '$lib/components/visit-blocks/Conclusioni.svelte';
  import FattoriRischioCV from '$lib/components/visit-blocks/FattoriRischioCV.svelte';
  import EsamiEmatici from '$lib/components/visit-blocks/EsamiEmatici.svelte';
  import FirmeVisita from '$lib/components/visit-blocks/FirmeVisita.svelte';
  import IpercolesterolemiaFamiliareFH from '$lib/components/visit-blocks/IpercolesterolemiaFamiliareFH.svelte';
  import Input from '$lib/components/Input.svelte';
  import TerapiaIpolipemizzante from '$lib/components/visit-blocks/TerapiaIpolipemizzante.svelte';
  import ValutazioneRischioCardiovascolare from '$lib/components/visit-blocks/ValutazioneRischioCardiovascolare.svelte';

  export let visita: Visita | null = null;
  export let isOpen = false;
  export let ambulatorioId: number;
  export let medicoId: number;

  const dispatch = createEventDispatcher();

  let pazienti: Paziente[] = [];
  let loadingPazienti = false;
  let searchTerm = '';
  let showPatientDropdown = false;
  let filteredPazienti: Paziente[] = [];
  let loadedStateKey = '';
  let previousEsamiLookupKey = '';
  $: currentAmbulatorio = $ambulatorioStore.current;
  $: isScaVisitAmbulatorio = isScaAmbulatorio(currentAmbulatorio);
  const tipoVisitaOptions = [
    { value: 'Prima visita', label: 'Prima visita' },
    { value: 'Controllo', label: 'Controllo' }
  ];

  function normalizeTipoVisita(value: string | null | undefined): string {
    return tipoVisitaOptions.some((option) => option.value === value) ? value ?? '' : '';
  }

  function isVisitBlockVisible(blockId: string): boolean {
    return isBlockVisibleForAmbulatorio(blockId, ambulatorioId, currentAmbulatorio);
  }

  function getTodayVisitDate(): string {
    return new Date().toISOString().split('T')[0];
  }

  function normalizeVisitDate(value: string | null | undefined): string {
    if (typeof value !== 'string') {
      return '';
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    const directDateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (directDateMatch) {
      return directDateMatch[1];
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }

    return parsed.toISOString().split('T')[0];
  }

  let formData = {
    paziente_id: 0,
    paziente_nome: '',
    data_visita: '',
    tipo_visita: '',
    motivo: '',
    altezza: '',
    peso: '',
    bmi: '',
    bsa: '',
    anamnesi: '',
    esame_obiettivo: '',
    diagnosi: '',
    terapia: '',
    note: ''
  };

  let fattoriRischio = createEmptyFattoriRischio();
  let fhAssessment = createEmptyFHAssessment();
  let terapiaIpolipemizzante = createEmptyTerapiaIpolipemizzante();
  let selectedPazienteRecord: Paziente | null = null;
  let etaPaziente: number | null = null;
  let sessoPaziente: 'M' | 'F' | 'Altro' | null = null;
  let pesoKg: number | null = null;
  let esamiEmatici = createEmptyEsamiEmatici();
  let previousEsamiEmatici: PreviousEsamiEmaticiMap = {};
  let valutazioneRischioCV = createEmptyValutazioneRischioCV();
  let conclusioni = '';
  let pianificazioneFollowUp = createEmptyPianificazioneFollowUp();
  let firmeVisita = createEmptyFirmeVisita();

  function formatFollowUpAdjustmentsMessage(
    requirements: AppuntamentoWriteRequirements
  ): string {
    if (!requirements.overlapAdjustments.length) {
      return 'Sono richiesti aggiustamenti automatici per evitare sovrapposizioni.';
    }

    const lines = requirements.overlapAdjustments.map((adjustment) => {
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

    return `Per evitare sovrapposizioni verranno applicate queste modifiche:\\n${lines.join('\\n')}`;
  }

  async function resolveFollowUpWriteOptions(
    followUpDateTime: string
  ): Promise<AppuntamentoWriteOptions | null> {
    let options: AppuntamentoWriteOptions = {};

    while (true) {
      const preview = await previewAppuntamentoWrite({
        ambulatorioId,
        dataOraInizio: followUpDateTime,
        options
      });

      if (preview.saved) {
        return options;
      }

      const requirements = preview.requirements;
      if (!requirements) {
        return options;
      }

      if (requirements.requiresOutsideHoursConfirmation && !options.confirmOutsideHours) {
        const confirmed = window.confirm(
          `${requirements.outsideHoursMessage || 'Appuntamento fuori orario/giorno di ambulatorio.'}\\n\\nConfermi comunque la prenotazione?`
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
        const confirmed = window.confirm(
          `${formatFollowUpAdjustmentsMessage(requirements)}\\n\\nConfermi le modifiche automatiche?`
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

  function createEmptyFattoriRischio() {
    return {
      familiarita: false,
      familiarita_note: '',
      ipertensione: false,
      diabete: false,
      diabete_durata: '',
      diabete_tipo: '' as DiabeteTipo,
      dislipidemia: false,
      obesita: false,
      fumo: '',
      fumo_ex_eta: ''
    };
  }

  $: if (searchTerm) {
    const term = searchTerm.toLowerCase();
    filteredPazienti = pazienti.filter((p) =>
      p.cognome.toLowerCase().includes(term) ||
      p.nome.toLowerCase().includes(term) ||
      p.codice_fiscale.toLowerCase().includes(term)
    );
  } else {
    filteredPazienti = pazienti;
  }
  $: etaPaziente = selectedPazienteRecord ? calculateAge(selectedPazienteRecord.data_nascita) : null;
  $: sessoPaziente = selectedPazienteRecord?.sesso || null;
  $: {
    const parsedPeso = formData.peso ? parseFloat(formData.peso) : NaN;
    pesoKg = Number.isFinite(parsedPeso) ? parsedPeso : null;
  }
  $: {
    const altezza = parseFloat(formData.altezza);
    const peso = parseFloat(formData.peso);

    if (altezza > 0 && peso > 0) {
      const altezzaMetri = altezza / 100;
      const bmi = peso / (altezzaMetri * altezzaMetri);
      const bsa = 0.007184 * Math.pow(altezza, 0.725) * Math.pow(peso, 0.425);
      const nextBmi = bmi.toFixed(2);
      const nextBsa = bsa.toFixed(2);

      if (formData.bmi !== nextBmi || formData.bsa !== nextBsa) {
        formData = {
          ...formData,
          bmi: nextBmi,
          bsa: nextBsa
        };
      }
    } else if (formData.bmi || formData.bsa) {
      formData = {
        ...formData,
        bmi: '',
        bsa: ''
      };
    }
  }
  $: {
    const normalizedRisk = normalizeValutazioneRischioCV(valutazioneRischioCV, esamiEmatici);
    if (!isValutazioneRischioCVEqual(valutazioneRischioCV, normalizedRisk)) {
      valutazioneRischioCV = normalizedRisk;
    }
  }
  $: if (pazienti.length > 0 && formData.paziente_id) {
    syncSelectedPazienteRecord();
  }
  $: {
    const esamiReferenceDate = (esamiEmatici.data_ee || '').trim() || formData.data_visita;
    const nextLookupKey =
      isOpen && formData.paziente_id
        ? `${formData.paziente_id}:${visita?.id || 'new'}:${esamiReferenceDate}`
        : '';
    if (previousEsamiLookupKey !== nextLookupKey) {
      previousEsamiLookupKey = nextLookupKey;
      void loadPreviousEsamiEmatici(nextLookupKey);
    }
  }

  $: if (isOpen) {
    const nextStateKey = visita?.id ? `visita-${visita.id}` : 'nuova';

    if (loadedStateKey !== nextStateKey) {
      if (visita) {
        applyVisitaState(visita);
      } else {
        resetNewVisitState();
      }

      loadedStateKey = nextStateKey;
    }
  } else {
    loadedStateKey = '';
  }

  $: if (isOpen && pazienti.length === 0) {
    loadPazienti();
  }

  async function loadPazienti() {
    loadingPazienti = true;
    try {
      pazienti = await getAllPazienti();
      syncSelectedPazienteRecord();
    } catch (error) {
      console.error('Errore caricamento pazienti:', error);
    } finally {
      loadingPazienti = false;
    }
  }

  function calculateAge(dataNascita: string): number {
    const today = new Date();
    const birthDate = new Date(dataNascita);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    return age;
  }

  function syncSelectedPazienteRecord() {
    if (!formData.paziente_id || pazienti.length === 0) {
      if (selectedPazienteRecord !== null) {
        selectedPazienteRecord = null;
      }
      return;
    }

    const match = pazienti.find((p) => p.id === formData.paziente_id) || null;
    if (selectedPazienteRecord?.id !== match?.id) {
      selectedPazienteRecord = match;
    }
  }

  function resetNewVisitState() {
    formData = {
      paziente_id: 0,
      paziente_nome: '',
      data_visita: getTodayVisitDate(),
      tipo_visita: '',
      motivo: '',
      altezza: '',
      peso: '',
      bmi: '',
      bsa: '',
      anamnesi: '',
      esame_obiettivo: '',
      diagnosi: '',
      terapia: '',
      note: ''
    };

    fattoriRischio = createEmptyFattoriRischio();
    fhAssessment = createEmptyFHAssessment();
    terapiaIpolipemizzante = createEmptyTerapiaIpolipemizzante();
    esamiEmatici = createEmptyEsamiEmatici();
    previousEsamiEmatici = {};
    valutazioneRischioCV = createEmptyValutazioneRischioCV();
    conclusioni = '';
    pianificazioneFollowUp = createEmptyPianificazioneFollowUp();
    firmeVisita = createEmptyFirmeVisita();
    selectedPazienteRecord = null;
    searchTerm = '';
    showPatientDropdown = false;
  }

  function applyVisitaState(record: Visita) {
    const dataVisita = normalizeVisitDate(record.data_visita);

    formData = {
      paziente_id: record.paziente_id,
      paziente_nome: `${record.paziente_cognome} ${record.paziente_nome}`,
      data_visita: dataVisita,
      tipo_visita: normalizeTipoVisita(record.tipo_visita),
      motivo: record.motivo,
      altezza: record.altezza ? String(record.altezza) : '',
      peso: record.peso ? String(record.peso) : '',
      bmi: record.bmi ? String(record.bmi) : '',
      bsa: record.bsa ? String(record.bsa) : '',
      anamnesi: record.anamnesi || '',
      esame_obiettivo: record.esame_obiettivo || '',
      diagnosi: record.diagnosi || '',
      terapia: isScaVisitAmbulatorio
        ? record.terapia_domiciliare || record.terapia || ''
        : record.terapia || '',
      note: record.note || ''
    };

    searchTerm = formData.paziente_nome;
    showPatientDropdown = false;
    esamiEmatici = parseEsamiEmatici(record.esami_ematici);
    valutazioneRischioCV = parseValutazioneRischioCV(record.valutazione_rischio_cv, esamiEmatici);
    conclusioni = record.conclusioni || '';
    pianificazioneFollowUp = parsePianificazioneFollowUp(record.pianificazione_followup);
    firmeVisita = parseFirmeVisita(record.firme_visita);
    fhAssessment = parseFHAssessment(record.fh_assessment);
    terapiaIpolipemizzante = parseTerapiaIpolipemizzante(record.terapia_ipolipemizzante);
    syncSelectedPazienteRecord();
    void loadFattoriRischio(record.id);
  }

  async function loadFattoriRischio(visitaId: number) {
    try {
      const result = await getFattoriRischioCVByVisitaId(visitaId);

      if (!result) {
        fattoriRischio = createEmptyFattoriRischio();
        return;
      }

      fattoriRischio = {
        familiarita: result.familiarita,
        familiarita_note: result.familiarita_note || '',
        ipertensione: result.ipertensione,
        diabete: result.diabete,
        diabete_durata: result.diabete_durata || '',
        diabete_tipo: result.diabete_tipo || '',
        dislipidemia: result.dislipidemia,
        obesita: result.obesita,
        fumo: result.fumo || '',
        fumo_ex_eta: result.fumo_ex_eta || ''
      };
    } catch (error) {
      console.error('Errore caricamento fattori rischio:', error);
      fattoriRischio = createEmptyFattoriRischio();
    }
  }

  function selectPaziente(paziente: Paziente) {
    formData.paziente_id = paziente.id;
    formData.paziente_nome = `${paziente.cognome} ${paziente.nome}`;
    selectedPazienteRecord = paziente;
    searchTerm = formData.paziente_nome;
    showPatientDropdown = false;
  }

  async function loadPreviousEsamiEmatici(requestKey = previousEsamiLookupKey) {
    const esamiReferenceDate = (esamiEmatici.data_ee || '').trim() || formData.data_visita;
    if (!formData.paziente_id || !esamiReferenceDate) {
      previousEsamiEmatici = {};
      return;
    }

    try {
      const nextValues = await getPreviousEsamiEmaticiByPaziente({
        pazienteId: formData.paziente_id,
        beforeDate: esamiReferenceDate,
        excludeVisitaId: visita?.id
      });

      if (requestKey !== previousEsamiLookupKey) {
        return;
      }

      previousEsamiEmatici = nextValues;
    } catch (error) {
      console.error('Errore caricamento storico esami:', error);
      if (requestKey === previousEsamiLookupKey) {
        previousEsamiEmatici = {};
      }
    }
  }

  async function handleSubmit() {
    if (!formData.paziente_id) {
      alert('Seleziona un paziente');
      return;
    }

    if (!formData.tipo_visita) {
      alert('Seleziona il tipo di visita');
      return;
    }

    if (!formData.motivo.trim()) {
      alert('Inserisci il motivo della visita');
      return;
    }

    if (isVisitBlockVisible('fattori-rischio-cv') && fattoriRischio.diabete && !fattoriRischio.diabete_tipo) {
      alert('Seleziona il tipo di diabete mellito');
      return;
    }

    if (isVisitBlockVisible('fh-assessment')) {
      const fhError = validateFHAssessment(fhAssessment);
      if (fhError) {
        alert(fhError);
        return;
      }
    }

    if (isVisitBlockVisible('terapia-ipolipemizzante')) {
      const terapiaError = validateTerapiaIpolipemizzante(terapiaIpolipemizzante);
      if (terapiaError) {
        alert(terapiaError);
        return;
      }
    }

    const followUpDateTime = (pianificazioneFollowUp.dataOraProssimaVisita || '').trim();
    let followUpWriteOptions: AppuntamentoWriteOptions | undefined;
    if (followUpDateTime) {
      try {
        const resolvedOptions = await resolveFollowUpWriteOptions(followUpDateTime);
        if (resolvedOptions === null) {
          alert('Programmazione prossima visita annullata');
          return;
        }
        followUpWriteOptions = resolvedOptions;
      } catch (error) {
        alert(
          `Impossibile validare la prossima visita: ${
            error instanceof Error ? error.message : 'errore sconosciuto'
          }`
        );
        return;
      }
    }

    const hasEsamiEmatici = isVisitBlockVisible('esami-ematici') && Object.values(esamiEmatici).some((value) => String(value || '').trim());
    const esamiEmaticiPayload = hasEsamiEmatici ? serializeEsamiEmatici(esamiEmatici) : undefined;
    if (isVisitBlockVisible('valutazione-rischio-cv')) {
      valutazioneRischioCV = normalizeValutazioneRischioCV(valutazioneRischioCV, esamiEmatici);
    }

    const visitaPayload = {
      ...(visita?.id ? { id: visita.id } : {}),
      ambulatorio_id: ambulatorioId,
      paziente_id: formData.paziente_id,
      medico_id: medicoId,
      data_visita: formData.data_visita,
      tipo_visita: formData.tipo_visita,
      motivo: formData.motivo,
      altezza: formData.altezza ? parseFloat(formData.altezza) : undefined,
      peso: formData.peso ? parseFloat(formData.peso) : undefined,
      bmi: formData.bmi ? parseFloat(formData.bmi) : undefined,
      bsa: formData.bsa ? parseFloat(formData.bsa) : undefined,
      esami_ematici: esamiEmaticiPayload,
      valutazione_rischio_cv: isVisitBlockVisible('valutazione-rischio-cv') ? serializeValutazioneRischioCV(valutazioneRischioCV, esamiEmatici) : undefined,
      fh_assessment: isVisitBlockVisible('fh-assessment') ? serializeFHAssessment(fhAssessment) : undefined,
      terapia_ipolipemizzante: isVisitBlockVisible('terapia-ipolipemizzante') ? serializeTerapiaIpolipemizzante(terapiaIpolipemizzante) : undefined,
      firme_visita: isVisitBlockVisible('firme-visita') ? serializeFirmeVisita(firmeVisita) : undefined,
      pianificazione_followup: serializePianificazioneFollowUp(pianificazioneFollowUp),
      conclusioni: conclusioni || undefined,
      anamnesi: formData.anamnesi || undefined,
      esame_obiettivo: formData.esame_obiettivo || undefined,
      diagnosi: formData.diagnosi || undefined,
      terapia_domiciliare: isScaVisitAmbulatorio ? formData.terapia || undefined : undefined,
      terapia: isScaVisitAmbulatorio ? undefined : formData.terapia || undefined,
      note: formData.note || undefined
    };

    dispatch('submit', {
      visita: visitaPayload,
      fattoriRischioCV: {
        ...(visita?.id ? { visita_id: visita.id } : {}),
        familiarita: fattoriRischio.familiarita,
        familiarita_note: fattoriRischio.familiarita_note || undefined,
        ipertensione: fattoriRischio.ipertensione,
        diabete: fattoriRischio.diabete,
        diabete_durata: fattoriRischio.diabete_durata || undefined,
        diabete_tipo: fattoriRischio.diabete_tipo || undefined,
        dislipidemia: fattoriRischio.dislipidemia,
        obesita: fattoriRischio.obesita,
        fumo: fattoriRischio.fumo,
        fumo_ex_eta: fattoriRischio.fumo_ex_eta || undefined
      },
      followUpWriteOptions
    });
  }

  function handleClose() {
    showPatientDropdown = false;
    dispatch('close');
  }

  function handleOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      handleClose();
    }
  }

  function handleOverlayKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleClose();
    }
  }
</script>

{#if isOpen}
  <div
    class="modal-overlay"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:click={handleOverlayClick}
    on:keydown={handleOverlayKeydown}
  >
    <div class="modal modal-large">
      <div class="modal-header">
        <h2>{visita ? 'Modifica Visita' : 'Nuova Visita'}</h2>
        <button class="close-btn" on:click={handleClose}>×</button>
      </div>

      <form on:submit|preventDefault={handleSubmit} class="modal-body">
        <div class="form-row">
          <div class="form-group">
            <label for="paziente">Paziente *</label>
            <div class="autocomplete">
              <input
                id="paziente"
                type="text"
                bind:value={searchTerm}
                on:focus={() => (showPatientDropdown = true)}
                on:input={() => (showPatientDropdown = true)}
                placeholder="Cerca per nome, cognome o CF"
                required={!formData.paziente_id}
                disabled={!!visita}
              />
              {#if showPatientDropdown && !visita}
                <div class="dropdown">
                  {#if loadingPazienti}
                    <div class="dropdown-item disabled">Caricamento...</div>
                  {:else if filteredPazienti.length === 0}
                    <div class="dropdown-item disabled">Nessun paziente trovato</div>
                  {:else}
                    {#each filteredPazienti.slice(0, 10) as paziente}
                      <button
                        type="button"
                        class="dropdown-item"
                        on:click={() => selectPaziente(paziente)}
                      >
                        <strong>{paziente.cognome} {paziente.nome}</strong>
                        <br />
                        <small>{paziente.codice_fiscale}</small>
                      </button>
                    {/each}
                  {/if}
                </div>
              {/if}
            </div>
          </div>

          <div class="form-group">
            <Input
              id="data_visita"
              type="date"
              label="Data visita"
              bind:value={formData.data_visita}
              required
            />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <span class="group-label">Tipo Visita *</span>
            <div class="visit-type-radio-group">
              {#each tipoVisitaOptions as option}
                <label class="visit-type-radio-option">
                  <input
                    type="radio"
                    name="visit_modal_tipo_visita"
                    value={option.value}
                    bind:group={formData.tipo_visita}
                    required
                  />
                  <span>{option.label}</span>
                </label>
              {/each}
            </div>
          </div>

          <div class="form-group">
            <label for="motivo">Motivo *</label>
            <input
              id="motivo"
              type="text"
              bind:value={formData.motivo}
              required
              placeholder="Motivo della visita"
            />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="altezza">Altezza (cm)</label>
            <input id="altezza" type="number" bind:value={formData.altezza} placeholder="es. 175" />
          </div>

          <div class="form-group">
            <label for="peso">Peso (kg)</label>
            <input id="peso" type="number" bind:value={formData.peso} placeholder="es. 70" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="bmi">BMI</label>
            <input id="bmi" type="text" bind:value={formData.bmi} placeholder="Automatico" disabled />
          </div>

          <div class="form-group">
            <label for="bsa">BSA (m²)</label>
            <input id="bsa" type="text" bind:value={formData.bsa} placeholder="Automatico" disabled />
          </div>
        </div>

        <div class="blocks-stack">
          {#if isVisitBlockVisible('fattori-rischio-cv')}
            <FattoriRischioCV
              bind:familiarita={fattoriRischio.familiarita}
              bind:familiarita_note={fattoriRischio.familiarita_note}
              bind:ipertensione={fattoriRischio.ipertensione}
              bind:diabete={fattoriRischio.diabete}
              bind:diabete_durata={fattoriRischio.diabete_durata}
              bind:diabete_tipo={fattoriRischio.diabete_tipo}
              bind:dislipidemia={fattoriRischio.dislipidemia}
              bind:obesita={fattoriRischio.obesita}
              bind:fumo={fattoriRischio.fumo}
              bind:fumo_ex_eta={fattoriRischio.fumo_ex_eta}
              bmi={null}
            />
          {/if}

          {#if isVisitBlockVisible('fh-assessment')}
            <IpercolesterolemiaFamiliareFH
              bind:enabled={fhAssessment.enabled}
              bind:familyHistoryOnePoint={fhAssessment.familyHistoryOnePoint}
              bind:familyHistoryTwoPoints={fhAssessment.familyHistoryTwoPoints}
              bind:clinicalPrematureCAD={fhAssessment.clinicalPrematureCAD}
              bind:clinicalPrematureCerebralOrPeripheral={fhAssessment.clinicalPrematureCerebralOrPeripheral}
              bind:physicalTendonXanthomas={fhAssessment.physicalTendonXanthomas}
              bind:physicalCornealArcusBefore45={fhAssessment.physicalCornealArcusBefore45}
              bind:untreatedLdlRange={fhAssessment.untreatedLdlRange}
              bind:geneticMutation={fhAssessment.geneticMutation}
              bind:totalScore={fhAssessment.totalScore}
              bind:classification={fhAssessment.classification}
            />
          {/if}

          {#if isVisitBlockVisible('terapia-ipolipemizzante')}
            <TerapiaIpolipemizzante bind:terapia={terapiaIpolipemizzante} />
          {/if}

          {#if isVisitBlockVisible('esami-ematici')}
            <EsamiEmatici
              bind:esami={esamiEmatici}
              eta={etaPaziente}
              peso={pesoKg}
              sesso={sessoPaziente}
              previousValues={previousEsamiEmatici}
            />
          {/if}

          {#if isVisitBlockVisible('valutazione-rischio-cv')}
            <ValutazioneRischioCardiovascolare
              bind:valutazione={valutazioneRischioCV}
              esami={esamiEmatici}
              terapia={terapiaIpolipemizzante}
              eta={etaPaziente}
            />
          {/if}
        </div>

        <div class="form-group">
          <label for="anamnesi">Anamnesi</label>
          <textarea
            id="anamnesi"
            bind:value={formData.anamnesi}
            rows="3"
            placeholder="Anamnesi del paziente"
          ></textarea>
        </div>

        <div class="form-group">
          <label for="esame_obiettivo">Esame Obiettivo</label>
          <textarea
            id="esame_obiettivo"
            bind:value={formData.esame_obiettivo}
            rows="3"
            placeholder="Esame obiettivo"
          ></textarea>
        </div>

        <div class="form-group">
          <label for="diagnosi">Diagnosi</label>
          <textarea
            id="diagnosi"
            bind:value={formData.diagnosi}
            rows="3"
            placeholder="Diagnosi"
          ></textarea>
        </div>

        <div class="form-group">
          <label for="terapia">
            {isScaVisitAmbulatorio ? 'Terapia domiciliare' : 'Terapia'}
          </label>
          <textarea
            id="terapia"
            bind:value={formData.terapia}
            rows="3"
            placeholder={isScaVisitAmbulatorio ? 'Terapia domiciliare' : 'Terapia prescritta'}
          ></textarea>
        </div>

        <div class="form-group">
          <label for="note">Note</label>
          <textarea
            id="note"
            bind:value={formData.note}
            rows="2"
            placeholder="Note aggiuntive"
          ></textarea>
        </div>

        <Conclusioni
          bind:conclusioni={conclusioni}
          bind:pianificazioneFollowUp={pianificazioneFollowUp}
          ambulatorioId={ambulatorioId}
        />

        {#if isVisitBlockVisible('firme-visita')}
          <FirmeVisita bind:firme={firmeVisita} />
        {/if}

        <div class="modal-footer">
          <button type="button" class="btn-secondary" on:click={handleClose}>
            Annulla
          </button>
          <button type="submit" class="btn-primary">
            {visita ? 'Salva Modifiche' : 'Crea Visita'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: var(--color-bg-primary);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-xl);
    width: 90%;
    max-width: 800px;
    max-height: 90vh;
    overflow-y: auto;
  }

  .modal-large {
    max-width: 1100px;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-6);
    border-bottom: 1px solid var(--color-border);
  }

  .modal-header h2 {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .close-btn {
    background: none;
    border: none;
    font-size: var(--text-3xl);
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    transition: all 0.2s;
  }

  .close-btn:hover {
    background: var(--color-bg-secondary);
    color: var(--color-text-primary);
  }

  .modal-body {
    padding: var(--space-6);
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }

  .form-group label {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  .group-label {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  .form-group input,
  .form-group textarea {
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--text-base);
    color: var(--color-text-primary);
    background: var(--color-bg-primary);
    transition: all 0.2s;
  }

  .form-group input:focus,
  .form-group textarea:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  .form-group input:disabled {
    background: var(--color-bg-secondary);
    cursor: not-allowed;
  }

  .form-group textarea {
    resize: vertical;
    min-height: 80px;
  }

  .visit-type-radio-group {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    min-height: 46px;
    align-items: center;
    padding: var(--space-1) 0;
  }

  .visit-type-radio-option {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text-primary);
    cursor: pointer;
  }

  .visit-type-radio-option input {
    margin: 0;
    cursor: pointer;
  }

  .autocomplete {
    position: relative;
  }

  .dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: var(--color-bg-primary);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    max-height: 300px;
    overflow-y: auto;
    z-index: 10;
    margin-top: 4px;
  }

  .dropdown-item {
    padding: var(--space-3);
    cursor: pointer;
    border-bottom: 1px solid var(--color-border);
    transition: background 0.2s;
    width: 100%;
    background: transparent;
    text-align: left;
    border-left: none;
    border-right: none;
    border-top: none;
    font: inherit;
  }

  .dropdown-item:last-child {
    border-bottom: none;
  }

  .dropdown-item:hover:not(.disabled) {
    background: var(--color-bg-secondary);
  }

  .dropdown-item.disabled {
    cursor: default;
    color: var(--color-text-tertiary);
  }

  .dropdown-item strong {
    color: var(--color-text-primary);
  }

  .dropdown-item small {
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
  }

  .blocks-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
  }

  .modal-footer {
    display: flex;
    gap: var(--space-3);
    justify-content: flex-end;
    margin-top: var(--space-6);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border);
  }

  .btn-primary,
  .btn-secondary {
    padding: var(--space-3) var(--space-6);
    border-radius: var(--radius-md);
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
    font-size: var(--text-base);
  }

  .btn-primary {
    background: var(--color-primary);
    color: white;
  }

  .btn-primary:hover {
    background: var(--color-primary-dark);
  }

  .btn-secondary {
    background: var(--color-bg-secondary);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
  }

  .btn-secondary:hover {
    background: var(--color-bg-tertiary);
  }

  @media (max-width: 768px) {
    .form-row {
      grid-template-columns: 1fr;
    }

    .modal {
      width: 95%;
    }
  }
</style>
