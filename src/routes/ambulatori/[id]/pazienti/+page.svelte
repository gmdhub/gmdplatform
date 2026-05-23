  <script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { invoke } from '@tauri-apps/api/core';
  import { exists, readFile } from '@tauri-apps/plugin-fs';
  import {
    getPazientiByAmbulatorio,
    getPazienteById,
    createPaziente,
    updatePaziente,
    deletePaziente
  } from '$lib/db/pazienti';
  import { getVisiteByPaziente } from '$lib/db/visite';
  import { getFattoriRischioCVByVisitaId } from '$lib/db/fattori-rischio-cv';
  import type { Paziente, CreatePazienteInput, Visita } from '$lib/db/types';
  import Button from '$lib/components/Button.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import Autocomplete from '$lib/components/Autocomplete.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import Table from '$lib/components/Table.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { formatDate } from '$lib/utils/formatters';
  import { calcolaCodiceFiscale } from '$lib/utils/codiceFiscale';
  import {
    parseEsamiEmatici,
    parseFHAssessment,
    parseFirmeVisita,
    parsePianificazioneFollowUp,
    parseTerapiaIpolipemizzante,
    parseValutazioneRischioCV
  } from '$lib/utils/visit-clinical';
  import type { AutocompleteItem } from '$lib/types/autocomplete';
  import type { GenerateVisitaRefertoInput } from '$lib/reports/generateVisitaReferto';
  import { sidebarCollapsedStore } from '$lib/stores/sidebar';
  import { toastStore } from '$lib/stores/toast';

  let ambulatorioId: number;
  let pazienti: Paziente[] = [];
  let filteredPazienti: Paziente[] = [];
  let searchTerm = '';
  let loading = true;
  let showModal = false;
  let showDeleteModal = false;
  let editingPaziente: Paziente | null = null;
  let pazienteToDelete: Paziente | null = null;
  type SelectedPazienteVisitaRow = Visita & { medico_label: string; versione_label: string };

  let selectedPaziente: Paziente | null = null;
  let showPatientDetailsModal = false;
  let selectedPazienteVisite: SelectedPazienteVisitaRow[] = [];
  let loadingSelectedPazienteVisite = false;
  let viewingReportVisitId: number | null = null;
  let showReportPreviewModal = false;
  let reportPreviewTitle = 'Anteprima referto';
  let reportPreviewLoading = false;
  let reportPreviewError = '';
  let reportPreviewPdfUrl = '';
  let wasReportPreviewModalOpen = false;

  // Dati per autocomplete
  let comuniData: AutocompleteItem[] = [];
  let statiData: AutocompleteItem[] = [];

  // Codici catastali per il calcolo CF
  let codiceCatastaleNascita = '';

  // Checkbox per esenzione
  let nessunaEsenzione = true;

  // Form fields
  let formData: CreatePazienteInput = {
    ambulatorio_id: 0,
    nome: '',
    cognome: '',
    data_nascita: '',
    luogo_nascita: '',
    codice_fiscale: '',
    sesso: 'M',
    esenzioni: 'Nessuno',
    indirizzo: '',
    citta: '',
    cap: '',
    provincia: '',
    telefono: '',
    email: ''
  };

  let formErrors: Record<string, string> = {};
  let displayedPazienti: Paziente[] = [];
  let patientTableMaxHeight: string | undefined = undefined;
  const MIN_SEARCH_TERM_LENGTH = 2;
  let lastIsSearchMode = false;

  $: ambulatorioId = parseInt($page.params.id || '0');
  $: isSearchMode = $page.url.searchParams.get('mode') === 'search';
  $: pageTitle = isSearchMode ? 'Cerca Paziente' : 'Gestione Anagrafica';
  $: pageSubtitle = isSearchMode
    ? 'Cerca il paziente da cui partire per consultare lo storico visite'
    : 'Gestisci i pazienti e le loro informazioni anagrafiche';
  $: searchPlaceholder = isSearchMode
    ? 'Scrivi almeno 2 caratteri per cercare per nome, cognome o codice fiscale...'
    : 'Scrivi almeno 2 caratteri per cercare per nome, cognome o codice fiscale...';
  $: if (lastIsSearchMode && !isSearchMode && selectedPaziente) {
    clearSelectedPaziente();
  }
  $: if (isSearchMode && selectedPaziente && !filteredPazienti.some((paziente) => paziente.id === selectedPaziente?.id)) {
    clearSelectedPaziente();
  }
  $: lastIsSearchMode = isSearchMode;

  // Calcola automaticamente il codice fiscale quando tutti i dati sono disponibili
  $: {
    if (formData.nome && formData.cognome && formData.data_nascita && formData.sesso && codiceCatastaleNascita) {
      const cf = calcolaCodiceFiscale({
        nome: formData.nome,
        cognome: formData.cognome,
        dataNascita: formData.data_nascita,
        sesso: formData.sesso,
        codiceComuneNascita: codiceCatastaleNascita
      });
      if (cf) {
        formData.codice_fiscale = cf;
      }
    }
  }

  onMount(async () => {
    try {
      // Carica dati comuni e stati
      const [comuniResponse, statiResponse] = await Promise.all([
        fetch('/comuni.json'),
        fetch('/stati.json')
      ]);
      comuniData = await comuniResponse.json();
      statiData = await statiResponse.json();

      await loadPazienti();
    } catch (error) {
      console.error('Errore caricamento pazienti:', error);
    } finally {
      loading = false;
    }
  });

  async function loadPazienti() {
    pazienti = await getPazientiByAmbulatorio(ambulatorioId);

    if (selectedPaziente) {
      const updatedSelectedPaziente = pazienti.find((paziente) => paziente.id === selectedPaziente?.id);
      if (updatedSelectedPaziente) {
        selectedPaziente = updatedSelectedPaziente;
      } else {
        clearSelectedPaziente();
      }
    }
  }

  function getFilteredPazienti(pazientiDaFiltrare: Paziente[], term: string): Paziente[] {
    const normalizedTerm = term.trim().toLowerCase();

    if (normalizedTerm.length < MIN_SEARCH_TERM_LENGTH) {
      return pazientiDaFiltrare;
    }

    return pazientiDaFiltrare.filter((paziente) =>
      [paziente.nome, paziente.cognome, paziente.codice_fiscale]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(normalizedTerm))
    );
  }

  function clearSelectedPaziente() {
    selectedPaziente = null;
    selectedPazienteVisite = [];
    loadingSelectedPazienteVisite = false;
    showPatientDetailsModal = false;
  }

  function getDisplayedPazienti(pazientiDaMostrare: Paziente[]): Paziente[] {
    return pazientiDaMostrare;
  }

  async function loadSelectedPazienteVisite(pazienteId: number) {
    loadingSelectedPazienteVisite = true;

    try {
      const visite = await getVisiteByPaziente(pazienteId);
      if (selectedPaziente?.id !== pazienteId) {
        return;
      }

      selectedPazienteVisite = visite.map((visita) => ({
        ...visita,
        medico_label: [visita.medico_cognome, visita.medico_nome].filter(Boolean).join(' ') || '-',
        versione_label: visita.is_current_version === 0 ? 'Versione precedente' : 'Versione definitiva'
      }));
    } catch (error) {
      console.error('Errore caricamento visite paziente:', error);
      if (selectedPaziente?.id === pazienteId) {
        selectedPazienteVisite = [];
      }
    } finally {
      if (selectedPaziente?.id === pazienteId) {
        loadingSelectedPazienteVisite = false;
      }
    }
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
    }

    return 'Errore sconosciuto';
  }

  async function safeExists(path: string): Promise<boolean> {
    try {
      return await exists(path);
    } catch (error) {
      console.warn(`Permission check failed for path "${path}":`, getErrorMessage(error));
      return false;
    }
  }

  async function buildVisitaRefertoInput(visita: Visita): Promise<GenerateVisitaRefertoInput> {
    const [paziente, fattori] = await Promise.all([
      getPazienteById(visita.paziente_id),
      getFattoriRischioCVByVisitaId(visita.id)
    ]);

    if (!paziente) {
      throw new Error('Paziente non trovato per questa visita');
    }

    const esami = parseEsamiEmatici(visita.esami_ematici);
    const valutazioneRischio = parseValutazioneRischioCV(visita.valutazione_rischio_cv, esami);

    return {
      paziente,
      formData: {
        data_visita: visita.data_visita || '',
        tipo_visita: visita.tipo_visita || '',
        motivo: visita.motivo || '',
        altezza: visita.altezza != null ? String(visita.altezza) : '',
        peso: visita.peso != null ? String(visita.peso) : '',
        bmi: visita.bmi != null ? String(visita.bmi) : ''
      },
      fattoriRischio: {
        familiarita: Boolean(fattori?.familiarita),
        familiarita_note: fattori?.familiarita_note || '',
        ipertensione: Boolean(fattori?.ipertensione),
        diabete: Boolean(fattori?.diabete),
        diabete_durata: fattori?.diabete_durata || '',
        diabete_tipo: fattori?.diabete_tipo || '',
        dislipidemia: Boolean(fattori?.dislipidemia),
        obesita: Boolean(fattori?.obesita),
        fumo: fattori?.fumo || '',
        fumo_ex_eta: fattori?.fumo_ex_eta || ''
      },
      fhAssessment: parseFHAssessment(visita.fh_assessment),
      anamnesiPatologicaRemota: visita.anamnesi_cardiologica || '',
      terapiaIpolipemizzante: parseTerapiaIpolipemizzante(visita.terapia_ipolipemizzante),
      terapiaDomiciliare: visita.terapia_domiciliare || '',
      esamiEmatici: esami,
      valutazioneRischioCV: valutazioneRischio,
      conclusioni: visita.conclusioni || '',
      pianificazioneFollowUp: parsePianificazioneFollowUp(visita.pianificazione_followup),
      firmeVisita: parseFirmeVisita(visita.firme_visita),
      visitaId: visita.id
    };
  }

  async function handleViewSelectedPazienteVisitaReport(visita: SelectedPazienteVisitaRow): Promise<void> {
    if (viewingReportVisitId !== null) {
      return;
    }

    viewingReportVisitId = visita.id;
    reportPreviewTitle = `Anteprima referto - ${visita.paziente_cognome} ${visita.paziente_nome}`;
    reportPreviewError = '';
    if (reportPreviewPdfUrl) {
      URL.revokeObjectURL(reportPreviewPdfUrl);
    }
    reportPreviewPdfUrl = '';
    reportPreviewLoading = true;
    showReportPreviewModal = true;

    try {
      const [{ generateVisitaReferto, resolveVisitaRefertoOutputPaths }] = await Promise.all([
        import('$lib/reports/generateVisitaReferto')
      ]);
      const reportInput = await buildVisitaRefertoInput(visita);
      const { docxPath, pdfPath } = await resolveVisitaRefertoOutputPaths(reportInput);
      const legacyPdfPath = docxPath.replace(/\.docx$/i, '.pdf');

      let resolvedPdfPath = pdfPath;
      if (!(await safeExists(resolvedPdfPath)) && (await safeExists(legacyPdfPath))) {
        resolvedPdfPath = legacyPdfPath;
      }

      if (!(await safeExists(resolvedPdfPath))) {
        let sourceDocxPath = docxPath;

        if (!(await safeExists(docxPath))) {
          const reportResult = await generateVisitaReferto(reportInput);
          if (!reportResult.saved || !reportResult.path) {
            throw new Error('Impossibile generare il referto DOCX');
          }
          sourceDocxPath = reportResult.path;
          if (reportResult.pdfPath && (await safeExists(reportResult.pdfPath))) {
            resolvedPdfPath = reportResult.pdfPath;
          }
        }

        if (!(await safeExists(resolvedPdfPath))) {
          try {
            resolvedPdfPath = await invoke<string>('convert_docx_to_pdf', {
              docxPath: sourceDocxPath,
              outputPdfPath: pdfPath
            });
            if (!(await safeExists(resolvedPdfPath))) {
              resolvedPdfPath = await invoke<string>('convert_docx_to_pdf', {
                docxPath: sourceDocxPath
              });
            }
          } catch (errorWithOutputPath) {
            resolvedPdfPath = await invoke<string>('convert_docx_to_pdf', {
              docxPath: sourceDocxPath
            });
            console.warn(
              'Fallback conversione PDF in modalità legacy:',
              getErrorMessage(errorWithOutputPath)
            );
          }
        }
      }

      const pdfBytes = await readFile(resolvedPdfPath);
      const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      reportPreviewPdfUrl = URL.createObjectURL(pdfBlob);
    } catch (error) {
      console.error('Errore visualizzazione referto visita da ricerca paziente:', error);
      reportPreviewError = `Anteprima non disponibile: ${getErrorMessage(error)}`;
    } finally {
      reportPreviewLoading = false;
      viewingReportVisitId = null;
    }
  }

  async function handleSelectPaziente(paziente: Paziente) {
    if (selectedPaziente?.id === paziente.id && !loadingSelectedPazienteVisite) {
      return;
    }

    selectedPaziente = paziente;
    showPatientDetailsModal = false;
    await loadSelectedPazienteVisite(paziente.id);
  }

  function openPatientDetailsModal() {
    if (!selectedPaziente) {
      return;
    }

    showPatientDetailsModal = true;
  }

  function openPatientDetailsModalFor(paziente: Paziente) {
    selectedPaziente = paziente;
    showPatientDetailsModal = true;
  }

  function handleCreateVisita() {
    if (!selectedPaziente) {
      return;
    }

    goto(`/ambulatori/${ambulatorioId}/visite/nuova?pazienteId=${selectedPaziente.id}`);
  }

  function openCreateModal() {
    editingPaziente = null;
    nessunaEsenzione = true;
    formData = {
      ambulatorio_id: ambulatorioId,
      nome: '',
      cognome: '',
      data_nascita: '',
      luogo_nascita: '',
      codice_fiscale: '',
      sesso: 'M',
      esenzioni: 'Nessuno',
      indirizzo: '',
      citta: '',
      cap: '',
      provincia: '',
      telefono: '',
      email: ''
    };
    formErrors = {};
    showModal = true;
  }

  function openEditModal(paziente: Paziente) {
    editingPaziente = paziente;
    nessunaEsenzione = paziente.esenzioni === 'Nessuno' || !paziente.esenzioni;
    formData = {
      ambulatorio_id: paziente.ambulatorio_id,
      nome: paziente.nome,
      cognome: paziente.cognome,
      data_nascita: paziente.data_nascita,
      luogo_nascita: paziente.luogo_nascita,
      codice_fiscale: paziente.codice_fiscale,
      sesso: paziente.sesso,
      esenzioni: paziente.esenzioni || 'Nessuno',
      indirizzo: paziente.indirizzo || '',
      citta: paziente.citta || '',
      cap: paziente.cap || '',
      provincia: paziente.provincia || '',
      telefono: paziente.telefono || '',
      email: paziente.email || ''
    };
    formErrors = {};
    showModal = true;
  }

  function openDeleteModal(paziente: Paziente) {
    pazienteToDelete = paziente;
    showDeleteModal = true;
  }

  function validateForm(): boolean {
    formErrors = {};

    if (!formData.nome.trim()) formErrors.nome = 'Nome obbligatorio';
    if (!formData.cognome.trim()) formErrors.cognome = 'Cognome obbligatorio';
    if (!formData.data_nascita) formErrors.data_nascita = 'Data di nascita obbligatoria';
    if (!formData.luogo_nascita.trim()) formErrors.luogo_nascita = 'Luogo di nascita obbligatorio';
    if (!formData.codice_fiscale.trim()) formErrors.codice_fiscale = 'Codice fiscale obbligatorio';

    // Validazione codice fiscale (16 caratteri)
    if (formData.codice_fiscale.length !== 16) {
      formErrors.codice_fiscale = 'Il codice fiscale deve essere di 16 caratteri';
    }

    return Object.keys(formErrors).length === 0;
  }

  async function handleSubmit() {
    if (!validateForm()) return;

    try {
      if (editingPaziente) {
        await updatePaziente({ ...formData, id: editingPaziente.id });
      } else {
        await createPaziente(formData);
      }
      await loadPazienti();
      showModal = false;
      toastStore.show('success', editingPaziente ? 'Paziente aggiornato con successo' : 'Paziente creato con successo');
    } catch (error) {
      console.error('Errore salvataggio paziente:', error);
      toastStore.show('error', `Errore salvataggio paziente: ${getErrorMessage(error)}`);
    }
  }

  async function handleDelete() {
    if (!pazienteToDelete) return;

    try {
      await deletePaziente(pazienteToDelete.id);
      await loadPazienti();
      showDeleteModal = false;
      pazienteToDelete = null;
      toastStore.show('success', 'Paziente eliminato con successo');
    } catch (error) {
      console.error('Errore eliminazione paziente:', error);
      toastStore.show('error', `Errore eliminazione paziente: ${getErrorMessage(error)}`);
    }
  }

  const managementTableColumns = [
    { key: 'cognome', label: 'Cognome', width: '18%' },
    { key: 'nome', label: 'Nome', width: '18%' },
    { key: 'codice_fiscale', label: 'Codice Fiscale', width: '20%' },
    {
      key: 'data_nascita',
      label: 'Data Nascita',
      width: '14%',
      format: (value: string) => formatDate(value)
    },
    { key: 'luogo_nascita', label: 'Luogo Nascita', width: '20%' },
    { key: 'sesso', label: 'Sesso', width: '10%' }
  ];

  const searchModeTableColumns = [
    { key: 'cognome', label: 'Cognome', width: '18%' },
    { key: 'nome', label: 'Nome', width: '18%' },
    { key: 'luogo_nascita', label: 'Luogo Nascita', width: '22%' },
    {
      key: 'data_nascita',
      label: 'Data Nascita',
      width: '14%',
      format: (value: string) => formatDate(value)
    },
    { key: 'codice_fiscale', label: 'Codice Fiscale', width: '28%' }
  ];

  const visiteTableColumns = [
    {
      key: 'data_visita',
      label: 'Data Visita',
      width: '16%',
      format: (value: string) => formatDate(value)
    },
    { key: 'tipo_visita', label: 'Tipo Visita', width: '16%' },
    { key: 'motivo', label: 'Motivo', width: '30%' },
    { key: 'versione_label', label: 'Stato', width: '20%' },
    { key: 'medico_label', label: 'Medico', width: '18%' }
  ];

  let tableColumns = managementTableColumns;
  let showTableActions = true;
  $: tableColumns = isSearchMode ? searchModeTableColumns : managementTableColumns;
  $: showTableActions = !isSearchMode;
  $: filteredPazienti = getFilteredPazienti(pazienti, searchTerm);
  $: displayedPazienti = getDisplayedPazienti(filteredPazienti);
  $: patientTableMaxHeight =
    isSearchMode && selectedPaziente && displayedPazienti.length > 5 ? '208px' : undefined;

  const sessoOptions = [
    { value: 'M', label: 'Maschio' },
    { value: 'F', label: 'Femmina' },
    { value: 'Altro', label: 'Altro' }
  ];

  $: {
    if (!showReportPreviewModal && wasReportPreviewModalOpen) {
      reportPreviewLoading = false;
      reportPreviewError = '';
      if (reportPreviewPdfUrl) {
        URL.revokeObjectURL(reportPreviewPdfUrl);
      }
      reportPreviewPdfUrl = '';
    }
    wasReportPreviewModalOpen = showReportPreviewModal;
  }
</script>

<div class="pazienti-page">
  <PageHeader
    title={pageTitle}
    subtitle={pageSubtitle}
    showLogo={$sidebarCollapsedStore}
    onBack={() => goto(`/ambulatori/${ambulatorioId}`)}
  >
    <div slot="actions" class="header-actions">
      {#if isSearchMode}
        <button
          type="button"
          class="btn-icon-text"
          on:click={openPatientDetailsModal}
          disabled={!selectedPaziente}
        >
          <span class="icon">
            <Icon name="user" size={24} />
          </span>
          <span class="text">Dettaglio<br />anagrafica</span>
        </button>
        <button
          type="button"
          class="btn-icon-text"
          on:click={handleCreateVisita}
          disabled={!selectedPaziente}
        >
          <span class="icon">
            <Icon name="file-plus" size={24} />
          </span>
          <span class="text">Inserisci visita</span>
        </button>
      {:else}
        <button type="button" class="btn-icon-text" on:click={openCreateModal}>
          <span class="icon">
            <Icon name="user-plus" size={24} />
          </span>
          <span class="text">Nuovo Paziente</span>
        </button>
      {/if}
    </div>
  </PageHeader>

  <div class="page-content">
    <div class="toolbar">
        <div class="search-box">
          <Input
            type="text"
            placeholder={searchPlaceholder}
            bind:value={searchTerm}
          />
        </div>
      </div>

      {#if loading}
        <div class="loading-state">Caricamento pazienti...</div>
      {:else}
        <Table
          columns={tableColumns}
          data={displayedPazienti}
          emptyMessage="Nessun paziente trovato"
          showActions={showTableActions}
          onRowClick={isSearchMode ? handleSelectPaziente : null}
          selectedRowId={isSearchMode && selectedPaziente ? selectedPaziente.id : null}
          maxHeight={patientTableMaxHeight}
        >
          <svelte:fragment slot="actions" let:row>
            <button
              class="btn-icon"
              on:click={() => openPatientDetailsModalFor(row)}
              title="Visualizza dettaglio"
            >
              <Icon name="eye" size={16} />
            </button>
            <button
              class="btn-icon"
              on:click={() => openEditModal(row)}
              title="Modifica"
            >
              <Icon name="pencil" size={16} />
            </button>
            <button
              class="btn-icon"
              on:click={() => openDeleteModal(row)}
              title="Elimina"
            >
              <Icon name="trash" size={16} />
            </button>
          </svelte:fragment>
        </Table>

        {#if isSearchMode && selectedPaziente}
          <div class="selected-patient-section">
            <div class="selected-patient-section-header">
              <div>
                <h2 class="selected-patient-title">Elenco visite</h2>
                <p class="selected-patient-subtitle">
                  {selectedPaziente.cognome} {selectedPaziente.nome}
                </p>
              </div>
            </div>

            {#if loadingSelectedPazienteVisite}
              <div class="loading-state">Caricamento visite del paziente...</div>
            {:else}
              <Table
                columns={visiteTableColumns}
                data={selectedPazienteVisite}
                emptyMessage="Nessuna visita trovata per questo paziente"
                showActions={true}
              >
                <svelte:fragment slot="cell" let:row let:column>
                  {#if column.key === 'tipo_visita'}
                    <span class="visita-tipo-nowrap" title={row[column.key] || '-'}>
                      {row[column.key] || '-'}
                    </span>
                  {:else if column.format && row[column.key]}
                    {column.format(row[column.key])}
                  {:else}
                    {row[column.key] || '-'}
                  {/if}
                </svelte:fragment>
                <svelte:fragment slot="actions" let:row>
                  <button
                    class="btn-icon"
                    on:click|stopPropagation={() => handleViewSelectedPazienteVisitaReport(row)}
                    title="Visualizza referto"
                    disabled={viewingReportVisitId !== null}
                  >
                    <Icon name="eye" size={16} />
                  </button>
                </svelte:fragment>
              </Table>
            {/if}
          </div>
        {/if}
      {/if}
  </div>
</div>

<!-- Modal Crea/Modifica Paziente -->
<Modal bind:open={showModal} title={editingPaziente ? 'Modifica Paziente' : 'Nuovo Paziente'} size="lg">
  <form on:submit|preventDefault={handleSubmit} class="paziente-form">
    <div class="form-row">
      <div class="form-col">
        <Input
          id="nome"
          label="Nome"
          bind:value={formData.nome}
          error={formErrors.nome}
          format="capitalize"
          required
        />
      </div>
      <div class="form-col">
        <Input
          id="cognome"
          label="Cognome"
          bind:value={formData.cognome}
          error={formErrors.cognome}
          format="capitalize"
          required
        />
      </div>
    </div>

    <div class="form-row">
      <div class="form-col">
        <Input
          id="data_nascita"
          type="date"
          label="Data di Nascita"
          bind:value={formData.data_nascita}
          error={formErrors.data_nascita}
          required
        />
      </div>
      <div class="form-col">
        <Autocomplete
          id="luogo_nascita"
          label="Luogo di Nascita"
          bind:value={formData.luogo_nascita}
          items={[...comuniData, ...statiData]}
          placeholder="Scrivi almeno 3 caratteri..."
          error={formErrors.luogo_nascita}
          minChars={3}
          onSelect={(item: AutocompleteItem) => { codiceCatastaleNascita = item.codiceCatastale; }}
          required
        />
      </div>
    </div>

    <div class="form-row">
      <div class="form-col">
        <Input
          id="codice_fiscale"
          label="Codice Fiscale"
          bind:value={formData.codice_fiscale}
          error={formErrors.codice_fiscale}
          placeholder="RSSMRA80E15H501Z"
          format="uppercase"
          required
        />
      </div>
      <div class="form-col">
        <Select
          id="sesso"
          label="Sesso"
          bind:value={formData.sesso}
          options={sessoOptions}
          required
        />
      </div>
    </div>

    <div class="form-row">
      <div class="form-col">
        <div class="checkbox-group">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={nessunaEsenzione} on:change={() => {
              if (nessunaEsenzione) {
                formData.esenzioni = 'Nessuno';
              } else {
                formData.esenzioni = '';
              }
            }} />
            <span>Nessuna esenzione</span>
          </label>
        </div>
        {#if !nessunaEsenzione}
          <Input
            id="esenzioni"
            label="Codice Esenzione"
            bind:value={formData.esenzioni}
            placeholder="E01, E02, etc."
            required
          />
        {/if}
      </div>
    </div>

    <h3 class="form-section-title">Residenza</h3>

    <div class="form-row">
      <div class="form-col-full">
        <Input
          id="indirizzo"
          label="Indirizzo"
          bind:value={formData.indirizzo}
          placeholder="Via/Piazza..."
        />
      </div>
    </div>

    <div class="form-row">
      <div class="form-col">
        <Autocomplete
          id="citta"
          label="Città"
          bind:value={formData.citta}
          items={comuniData}
          placeholder="Scrivi almeno 3 caratteri..."
          minChars={3}
        />
      </div>
      <div class="form-col-sm">
        <Input
          id="cap"
          label="CAP"
          bind:value={formData.cap}
          placeholder="00100"
        />
      </div>
      <div class="form-col-sm">
        <Input
          id="provincia"
          label="Provincia"
          bind:value={formData.provincia}
          placeholder="RM"
          format="uppercase"
        />
      </div>
    </div>

    <h3 class="form-section-title">Contatti</h3>

    <div class="form-row">
      <div class="form-col">
        <Input
          id="telefono"
          type="tel"
          label="Telefono"
          bind:value={formData.telefono}
          placeholder="+39 ..."
        />
      </div>
      <div class="form-col">
        <Input
          id="email"
          type="email"
          label="Email"
          bind:value={formData.email}
          placeholder="email@esempio.it"
        />
      </div>
    </div>
  </form>

  <svelte:fragment slot="footer">
    <Button variant="secondary" on:click={() => (showModal = false)}>
      Annulla
    </Button>
    <Button variant="primary" on:click={handleSubmit}>
      {editingPaziente ? 'Salva Modifiche' : 'Crea Paziente'}
    </Button>
  </svelte:fragment>
</Modal>

<!-- Modal Conferma Eliminazione -->
<Modal bind:open={showDeleteModal} title="Conferma Eliminazione" size="sm">
  <p>Sei sicuro di voler eliminare il paziente <strong>{pazienteToDelete?.nome} {pazienteToDelete?.cognome}</strong>?</p>
  <p class="warning-text">Questa azione non può essere annullata.</p>

  <svelte:fragment slot="footer">
    <Button variant="secondary" on:click={() => (showDeleteModal = false)}>
      Annulla
    </Button>
    <Button variant="danger" on:click={handleDelete}>
      Elimina
    </Button>
  </svelte:fragment>
</Modal>

<Modal bind:open={showPatientDetailsModal} title="Dettaglio anagrafica" size="lg">
  {#if selectedPaziente}
    <div class="patient-details-grid">
      <div class="patient-detail-item">
        <span class="patient-detail-label">Nome</span>
        <strong class="patient-detail-value">{selectedPaziente.nome}</strong>
      </div>
      <div class="patient-detail-item">
        <span class="patient-detail-label">Cognome</span>
        <strong class="patient-detail-value">{selectedPaziente.cognome}</strong>
      </div>
      <div class="patient-detail-item">
        <span class="patient-detail-label">Data di nascita</span>
        <strong class="patient-detail-value">{formatDate(selectedPaziente.data_nascita)}</strong>
      </div>
      <div class="patient-detail-item">
        <span class="patient-detail-label">Luogo di nascita</span>
        <strong class="patient-detail-value">{selectedPaziente.luogo_nascita}</strong>
      </div>
      <div class="patient-detail-item">
        <span class="patient-detail-label">Codice fiscale</span>
        <strong class="patient-detail-value">{selectedPaziente.codice_fiscale}</strong>
      </div>
      <div class="patient-detail-item">
        <span class="patient-detail-label">Sesso</span>
        <strong class="patient-detail-value">{selectedPaziente.sesso}</strong>
      </div>
      <div class="patient-detail-item">
        <span class="patient-detail-label">Esenzioni</span>
        <strong class="patient-detail-value">{selectedPaziente.esenzioni || 'Nessuno'}</strong>
      </div>
      <div class="patient-detail-item full-width">
        <span class="patient-detail-label">Indirizzo</span>
        <strong class="patient-detail-value">{selectedPaziente.indirizzo || '-'}</strong>
      </div>
      <div class="patient-detail-item">
        <span class="patient-detail-label">Città</span>
        <strong class="patient-detail-value">{selectedPaziente.citta || '-'}</strong>
      </div>
      <div class="patient-detail-item">
        <span class="patient-detail-label">CAP</span>
        <strong class="patient-detail-value">{selectedPaziente.cap || '-'}</strong>
      </div>
      <div class="patient-detail-item">
        <span class="patient-detail-label">Provincia</span>
        <strong class="patient-detail-value">{selectedPaziente.provincia || '-'}</strong>
      </div>
      <div class="patient-detail-item">
        <span class="patient-detail-label">Telefono</span>
        <strong class="patient-detail-value">{selectedPaziente.telefono || '-'}</strong>
      </div>
      <div class="patient-detail-item full-width">
        <span class="patient-detail-label">Email</span>
        <strong class="patient-detail-value">{selectedPaziente.email || '-'}</strong>
      </div>
    </div>
  {/if}

  <svelte:fragment slot="footer">
    <Button variant="secondary" on:click={() => (showPatientDetailsModal = false)}>
      Chiudi
    </Button>
  </svelte:fragment>
</Modal>

<Modal
  bind:open={showReportPreviewModal}
  title={reportPreviewTitle}
  size="xl"
  closeOnBackdropClick={false}
  hideFooter={true}
  compactHeader={true}
>
  <div class="report-preview-wrapper">
    {#if reportPreviewError}
      <div class="report-preview-error">{reportPreviewError}</div>
    {/if}

    {#if reportPreviewPdfUrl && !reportPreviewLoading && !reportPreviewError}
      <iframe class="report-preview-frame" src={reportPreviewPdfUrl} title="Anteprima referto PDF"></iframe>
    {/if}

    {#if reportPreviewLoading}
      <div class="report-preview-loading">Caricamento anteprima referto...</div>
    {/if}
  </div>
</Modal>

<style>
  .pazienti-page {
    min-height: 100vh;
    padding: var(--space-8);
  }

  .page-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .toolbar {
    display: flex;
    gap: var(--space-4);
    align-items: flex-end;
  }

  .search-box {
    flex: 1;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .loading-state {
    text-align: center;
    padding: var(--space-12);
    color: var(--color-text-secondary);
  }

  .selected-patient-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .selected-patient-section-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .selected-patient-title {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--color-text);
  }

  .selected-patient-subtitle {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .paziente-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
  }

  .form-col {
    grid-column: span 1;
  }

  .form-col-full {
    grid-column: span 2;
  }

  .form-col-sm {
    grid-column: span 1;
    max-width: 150px;
  }

  .form-section-title {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--color-text);
    margin-top: var(--space-4);
    margin-bottom: 0;
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--color-border);
  }

  .checkbox-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
    font-size: var(--text-base);
    color: var(--color-text);
  }

  .checkbox-label input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
    border: 2px solid var(--color-border);
    border-radius: var(--radius-sm);
  }

  .warning-text {
    color: var(--color-error);
    font-size: var(--text-sm);
    margin-top: var(--space-2);
  }

  .patient-details-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .patient-detail-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-bg-secondary);
  }

  .patient-detail-item.full-width {
    grid-column: 1 / -1;
  }

  .patient-detail-label {
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .patient-detail-value {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--color-text);
    word-break: break-word;
  }

  .report-preview-wrapper {
    position: relative;
    min-height: 68vh;
  }

  .report-preview-frame {
    width: 100%;
    height: 68vh;
    border: 0;
    border-radius: 0;
    background: #ffffff;
  }

  .report-preview-loading,
  .report-preview-error {
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: var(--space-6);
  }

  .report-preview-loading {
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--color-bg-primary) 82%, transparent);
    color: var(--color-text-secondary);
  }

  .report-preview-error {
    color: var(--color-danger, #b91c1c);
    font-weight: 500;
  }

  .visita-tipo-nowrap {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  :global(.btn-icon) {
    background: none;
    border: none;
    cursor: pointer;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    transition: all var(--transition-fast);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    opacity: 0.6;
  }

  :global(.btn-icon:hover:not(:disabled)) {
    background-color: var(--color-bg-secondary);
    opacity: 1;
  }

  :global(.btn-icon:disabled) {
    opacity: 0.3;
    cursor: not-allowed;
  }

  @media (max-width: 768px) {
    .patient-details-grid {
      grid-template-columns: 1fr;
    }

    .patient-detail-item.full-width {
      grid-column: auto;
    }
  }
</style>
