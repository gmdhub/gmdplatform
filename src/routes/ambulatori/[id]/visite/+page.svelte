<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { invoke } from '@tauri-apps/api/core';
  import { exists, readFile } from '@tauri-apps/plugin-fs';
  import { ambulatorioStore } from '$lib/stores/ambulatorio';
  import { sidebarCollapsedStore } from '$lib/stores/sidebar';
  import { toastStore } from '$lib/stores/toast';
  import { getPazienteById } from '$lib/db/pazienti';
  import { getFattoriRischioCVByVisitaId } from '$lib/db/fattori-rischio-cv';
  import { getVisiteByAmbulatorio, deleteVisita } from '$lib/db/visite';
  import {
    getVisitaEditDeleteLockedMessage,
    getVisitaPreviousVersionLockedMessage,
    isVisitaWithinEditDeleteWindow
  } from '$lib/utils/visite-permissions';
  import {
    parseEsamiEmatici,
    parseFHAssessment,
    parseFirmeVisita,
    parsePianificazioneFollowUp,
    parseTerapiaIpolipemizzante,
    parseValutazioneRischioCV
  } from '$lib/utils/visit-clinical';
  import Card from '$lib/components/Card.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import Button from '$lib/components/Button.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import type { Visita } from '$lib/db/types';
  import type { GenerateVisitaRefertoInput } from '$lib/reports/generateVisitaReferto';

  $: ambulatorio = $ambulatorioStore.current;

  let visite: Visita[] = [];
  type SortKey = 'data' | 'paziente' | 'tipo' | 'medico';
  type SortDirection = 'asc' | 'desc';
  let sortKey: SortKey = 'data';
  let sortDirection: SortDirection = 'desc';
  let filteredVisite: Visita[] = [];
  let sortedVisite: Visita[] = [];
  let loading = true;
  let filterDataFrom = '';
  let filterDataTo = '';
  let filterPaziente = '';
  let filterTipo = '';
  let filterMotivo = '';
  let filterMedico = '';
  let hasColumnFilters = false;
  let tipoFilterOptions: Array<{ value: string; label: string }> = [];
  let showDeleteModal = false;
  let viewingReportVisitId: number | null = null;
  let showReportPreviewModal = false;
  let reportPreviewTitle = 'Anteprima referto';
  let reportPreviewLoading = false;
  let reportPreviewError = '';
  let reportPreviewPdfUrl = '';
  let wasReportPreviewModalOpen = false;
  let visitToDelete: Visita | null = null;
  const visitEditDeleteLockedMessage = getVisitaEditDeleteLockedMessage();
  const visitPreviousVersionLockedMessage = getVisitaPreviousVersionLockedMessage();

  function isCurrentVersion(visita: Visita): boolean {
    return visita.is_current_version !== 0;
  }

  function getVisitaMutationBlockedReason(visita: Visita): string | null {
    if (!isCurrentVersion(visita)) {
      return visitPreviousVersionLockedMessage;
    }

    if (!isVisitaWithinEditDeleteWindow(visita.data_visita)) {
      return visitEditDeleteLockedMessage;
    }

    return null;
  }

  function canMutateVisita(visita: Visita): boolean {
    return !getVisitaMutationBlockedReason(visita);
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

  async function loadVisite() {
    if (!ambulatorio) return;

    loading = true;
    try {
      visite = await getVisiteByAmbulatorio(ambulatorio.id);
    } catch (error) {
      console.error('Errore caricamento visite:', error);
      // Non mostrare errore se è solo un problema di inizializzazione
      const errorMessage = error instanceof Error ? error.message : '';
      if (!errorMessage.includes('Database non inizializzato')) {
        toastStore.show('error', 'Errore durante il caricamento delle visite');
      }
    } finally {
      loading = false;
    }
  }

  function handleNewVisit() {
    goto(`/ambulatori/${ambulatorio?.id}/visite/nuova`);
  }

  function handleEditVisit(visita: Visita) {
    const blockedReason = getVisitaMutationBlockedReason(visita);
    if (blockedReason) {
      toastStore.show('error', blockedReason);
      return;
    }

    goto(`/ambulatori/${ambulatorio?.id}/visite/nuova?editVisitaId=${visita.id}`);
  }

  function openDeleteModal(visita: Visita) {
    const blockedReason = getVisitaMutationBlockedReason(visita);
    if (blockedReason) {
      toastStore.show('error', blockedReason);
      return;
    }

    visitToDelete = visita;
    showDeleteModal = true;
  }

  async function handleDeleteVisit() {
    if (!visitToDelete) return;

    try {
      await deleteVisita(visitToDelete.id);
      toastStore.show('success', 'Visita eliminata con successo!');
      await loadVisite();
      showDeleteModal = false;
      visitToDelete = null;
    } catch (error) {
      console.error('Errore eliminazione visita:', error);
      toastStore.show('error', `Errore durante l'eliminazione della visita: ${getErrorMessage(error)}`);
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
      ambulatorioId: visita.ambulatorio_id,
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
      anamnesi: visita.anamnesi || visita.anamnesi_cardiologica || '',
      terapiaIpolipemizzante: parseTerapiaIpolipemizzante(visita.terapia_ipolipemizzante),
      terapiaDomiciliare: visita.terapia_domiciliare || '',
      valutazioneOdierna: visita.valutazione_odierna || '',
      esamiEmatici: esami,
      valutazioneRischioCV: valutazioneRischio,
      conclusioni: visita.conclusioni || '',
      pianificazioneFollowUp: parsePianificazioneFollowUp(visita.pianificazione_followup),
      firmeVisita: parseFirmeVisita(visita.firme_visita),
      visitaId: visita.id
    };
  }

  async function handleViewVisitReport(visita: Visita): Promise<void> {
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
      console.error('Errore visualizzazione referto visita:', error);
      console.error('Dettaglio errore anteprima referto:', getErrorMessage(error));
      reportPreviewError = `Anteprima non disponibile: ${getErrorMessage(error)}`;
    } finally {
      reportPreviewLoading = false;
      viewingReportVisitId = null;
    }
  }

  function formatDate(dateString: string): string {
    const directDateMatch = dateString.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (directDateMatch) {
      return `${directDateMatch[3]}/${directDateMatch[2]}/${directDateMatch[1]}`;
    }

    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
      return dateString;
    }

    return new Intl.DateTimeFormat('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(date);
  }

  function toComparableDateKey(dateString: string): string {
    const directDateMatch = dateString.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (directDateMatch) {
      return `${directDateMatch[1]}-${directDateMatch[2]}-${directDateMatch[3]}`;
    }

    const parsed = new Date(dateString);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }

    const year = String(parsed.getFullYear());
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function compareStrings(left: string, right: string): number {
    return left.localeCompare(right, 'it', { sensitivity: 'base', numeric: true });
  }

  function getSortValue(visita: Visita, key: SortKey): string | number {
    if (key === 'data') {
      const parsed = new Date(visita.data_visita).getTime();
      return Number.isFinite(parsed) ? parsed : 0;
    }

    if (key === 'paziente') {
      return `${visita.paziente_cognome || ''} ${visita.paziente_nome || ''}`.trim();
    }

    if (key === 'tipo') {
      return visita.tipo_visita || '';
    }

    return `${visita.medico_cognome || ''} ${visita.medico_nome || ''}`.trim();
  }

  function handleSort(nextKey: SortKey): void {
    if (sortKey === nextKey) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      return;
    }

    sortKey = nextKey;
    sortDirection = nextKey === 'data' ? 'desc' : 'asc';
  }

  function getSortIndicator(key: SortKey): string {
    if (sortKey !== key) {
      return '↕';
    }
    return sortDirection === 'asc' ? '↑' : '↓';
  }

  function resetColumnFilters(): void {
    filterDataFrom = '';
    filterDataTo = '';
    filterPaziente = '';
    filterTipo = '';
    filterMotivo = '';
    filterMedico = '';
  }

  onMount(() => {
    void loadVisite();
  });

  $: {
    const normalizedPaziente = filterPaziente.trim().toLowerCase();
    const normalizedMotivo = filterMotivo.trim().toLowerCase();
    const normalizedMedico = filterMedico.trim().toLowerCase();

    filteredVisite = visite.filter((visita) => {
      const visitDateKey = toComparableDateKey(visita.data_visita);
      const pazienteValue = `${visita.paziente_cognome || ''} ${visita.paziente_nome || ''}`
        .trim()
        .toLowerCase();
      const motivoValue = (visita.motivo || '').toLowerCase();
      const medicoValue = `${visita.medico_cognome || ''} ${visita.medico_nome || ''}`
        .trim()
        .toLowerCase();

      const matchesDataFrom = !filterDataFrom || (visitDateKey !== '' && visitDateKey >= filterDataFrom);
      const matchesDataTo = !filterDataTo || (visitDateKey !== '' && visitDateKey <= filterDataTo);
      const matchesPaziente = !normalizedPaziente || pazienteValue.includes(normalizedPaziente);
      const matchesTipo = !filterTipo || visita.tipo_visita === filterTipo;
      const matchesMotivo = !normalizedMotivo || motivoValue.includes(normalizedMotivo);
      const matchesMedico = !normalizedMedico || medicoValue.includes(normalizedMedico);

      return (
        matchesDataFrom &&
        matchesDataTo &&
        matchesPaziente &&
        matchesTipo &&
        matchesMotivo &&
        matchesMedico
      );
    });
  }

  $: {
    hasColumnFilters = Boolean(
      filterDataFrom ||
      filterDataTo ||
      filterPaziente.trim() ||
      filterTipo ||
      filterMotivo.trim() ||
      filterMedico.trim()
    );
  }

  $: {
    const uniqueTypes = Array.from(
      new Set(
        visite
          .map((visita) => visita.tipo_visita?.trim())
          .filter((value): value is string => Boolean(value))
      )
    ).sort((left, right) => compareStrings(left, right));

    tipoFilterOptions = [
      { value: '', label: 'Tutti' },
      ...uniqueTypes.map((value) => ({ value, label: value }))
    ];
  }

  $: {
    const directionMultiplier = sortDirection === 'asc' ? 1 : -1;
    sortedVisite = [...filteredVisite].sort((left, right) => {
      const leftValue = getSortValue(left, sortKey);
      const rightValue = getSortValue(right, sortKey);

      let result = 0;
      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        result = leftValue - rightValue;
      } else {
        result = compareStrings(String(leftValue || ''), String(rightValue || ''));
      }

      if (result === 0) {
        const leftDate = Number.isFinite(new Date(left.data_visita).getTime()) ? new Date(left.data_visita).getTime() : 0;
        const rightDate = Number.isFinite(new Date(right.data_visita).getTime()) ? new Date(right.data_visita).getTime() : 0;
        result = rightDate - leftDate;
      }

      return result * directionMultiplier;
    });
  }

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

<div class="visite-page">
  <PageHeader
    title="Archivio Visite"
    subtitle="Visualizza e consulta le visite mediche"
    showLogo={$sidebarCollapsedStore}
    onBack={() => goto(`/ambulatori/${ambulatorio?.id}`)}
  >
    <div slot="actions">
      <button type="button" class="btn-icon-text" on:click={handleNewVisit}>
        <span class="icon">
          <Icon name="file-plus" size={24} />
        </span>
        <span class="text">Nuova Visita</span>
      </button>
    </div>
  </PageHeader>

  <div class="page-content">
    {#if loading}
      <Card padding="sm">
        <div class="loading-state">Caricamento visite...</div>
      </Card>
    {:else if visite.length === 0}
      <Card padding="sm">
        <div class="empty-state">
          <div class="empty-icon">
            <Icon name="file-text" size={48} />
          </div>
          <h3 class="empty-title">Nessuna visita registrata</h3>
          <p class="empty-text">Inizia registrando la prima visita medica</p>
        </div>
      </Card>
    {:else}
      <div class="filters-sticky">
        <div class="filters-panel">
          <div class="filters-grid">
            <Input
              type="date"
              label="Data dal"
              bind:value={filterDataFrom}
            />
            <Input
              type="date"
              label="Data al"
              bind:value={filterDataTo}
            />
            <Input
              type="text"
              label="Paziente"
              placeholder="Cognome o nome"
              bind:value={filterPaziente}
            />
            <Select
              id="filtro-tipo-visita"
              label="Tipo"
              placeholder=""
              options={tipoFilterOptions}
              bind:value={filterTipo}
            />
            <Input
              type="text"
              label="Motivo"
              placeholder="Filtra motivo"
              bind:value={filterMotivo}
            />
            <Input
              type="text"
              label="Medico"
              placeholder="Cognome o nome"
              bind:value={filterMedico}
            />
          </div>
          <div class="filters-actions">
            <span class="filters-count">
              {sortedVisite.length} {sortedVisite.length === 1 ? 'visita' : 'visite'}
            </span>
            <button
              type="button"
              class="btn-filter-reset"
              on:click={resetColumnFilters}
              disabled={!hasColumnFilters}
            >
              Azzera filtri
            </button>
          </div>
        </div>
      </div>

      <Card padding="sm">
        <div class="table-container">
          <table class="table">
            <thead>
              <tr>
                <th>
                  <button type="button" class="sort-btn" on:click={() => handleSort('data')}>
                    <span>Data</span>
                    <span class="sort-arrow">{getSortIndicator('data')}</span>
                  </button>
                </th>
                <th>
                  <button type="button" class="sort-btn" on:click={() => handleSort('paziente')}>
                    <span>Paziente</span>
                    <span class="sort-arrow">{getSortIndicator('paziente')}</span>
                  </button>
                </th>
                <th>
                  <button type="button" class="sort-btn" on:click={() => handleSort('tipo')}>
                    <span>Tipo</span>
                    <span class="sort-arrow">{getSortIndicator('tipo')}</span>
                  </button>
                </th>
                <th>Motivo</th>
                <th>
                  <button type="button" class="sort-btn" on:click={() => handleSort('medico')}>
                    <span>Medico</span>
                    <span class="sort-arrow">{getSortIndicator('medico')}</span>
                  </button>
                </th>
                <th>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {#if sortedVisite.length === 0}
                <tr>
                  <td class="empty-filtered-cell" colspan="6">
                    Nessuna visita trovata con i filtri selezionati
                  </td>
                </tr>
              {:else}
                {#each sortedVisite as visita (visita.id)}
                  <tr>
                    <td>
                      <div class="date-main">{formatDate(visita.data_visita)}</div>
                      {#if !isCurrentVersion(visita)}
                        <div class="version-badge">Versione precedente</div>
                      {/if}
                    </td>
                    <td>
                      <div class="patient-cell">
                        <strong>{visita.paziente_cognome} {visita.paziente_nome}</strong>
                        <div class="patient-cf">{visita.paziente_codice_fiscale}</div>
                      </div>
                    </td>
                    <td>
                      <span class="badge badge-{visita.tipo_visita.toLowerCase().replace(' ', '-')}">
                        {visita.tipo_visita}
                      </span>
                    </td>
                    <td>{visita.motivo}</td>
                    <td>{visita.medico_cognome} {visita.medico_nome}</td>
                    <td>
                      <div class="actions">
                        <button
                          class="btn-icon"
                          on:click={() => handleViewVisitReport(visita)}
                          title="Visualizza"
                          disabled={viewingReportVisitId !== null}
                        >
                          <Icon name="eye" size={16} />
                        </button>
                        <button
                          class="btn-icon"
                          on:click={() => handleEditVisit(visita)}
                          title={canMutateVisita(visita) ? 'Modifica' : (getVisitaMutationBlockedReason(visita) || '')}
                          disabled={!canMutateVisita(visita)}
                        >
                          <Icon name="pencil" size={16} />
                        </button>
                        <button
                          class="btn-icon"
                          on:click={() => openDeleteModal(visita)}
                          title={canMutateVisita(visita) ? 'Elimina' : (getVisitaMutationBlockedReason(visita) || '')}
                          disabled={!canMutateVisita(visita)}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                {/each}
              {/if}
            </tbody>
          </table>
        </div>
      </Card>
    {/if}
  </div>
</div>

<!-- Modal Conferma Eliminazione -->
<Modal bind:open={showDeleteModal} title="Conferma Eliminazione" size="sm">
  <p style="margin-bottom: var(--space-6);">
    Sei sicuro di voler eliminare la visita del paziente
    <strong>{visitToDelete?.paziente_cognome} {visitToDelete?.paziente_nome}</strong>
    del {visitToDelete ? formatDate(visitToDelete.data_visita) : ''}?<br />
    Questa azione non può essere annullata.
  </p>
  <div style="display: flex; gap: var(--space-3); justify-content: flex-end;">
    <Button variant="secondary" on:click={() => (showDeleteModal = false)}>
      Annulla
    </Button>
    <Button variant="primary" on:click={handleDeleteVisit}> Conferma Eliminazione </Button>
  </div>
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
  .visite-page {
    padding: var(--space-6);
    max-width: 1400px;
    margin: 0 auto;
  }

  .page-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .filters-sticky {
    position: sticky;
    top: var(--space-3);
    z-index: 20;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-6);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .page-title {
    font-size: var(--text-3xl);
    font-weight: 700;
    color: var(--color-text-primary);
    margin: 0 0 var(--space-2) 0;
  }

  .page-subtitle {
    font-size: var(--text-base);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .btn-primary {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-5);
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: var(--radius-md);
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-primary:hover {
    background: var(--color-primary-dark);
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
  }

  .btn-icon {
    font-size: var(--text-lg);
  }

  .loading-state {
    text-align: center;
    padding: var(--space-12);
    color: var(--color-text-secondary);
  }

  .empty-state {
    text-align: center;
    padding: var(--space-12);
  }

  .empty-icon {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: var(--space-4);
    color: var(--color-text-tertiary);
  }

  .empty-icon :global(.icon-svg) {
    width: 64px;
    height: 64px;
    stroke-width: 1.5;
    opacity: 0.5;
  }

  .empty-title {
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--color-text-primary);
    margin: 0 0 var(--space-2) 0;
  }

  .empty-text {
    color: var(--color-text-secondary);
    margin: 0 0 var(--space-6) 0;
  }

  .table-container {
    overflow-x: auto;
  }

  .filters-panel {
    padding: var(--space-5);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    background: var(--color-bg-secondary);
  }

  .filters-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .filters-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: var(--space-3);
  }

  .filters-count {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .btn-filter-reset {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg);
    color: var(--color-text);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .btn-filter-reset:hover:not(:disabled) {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  .btn-filter-reset:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .table {
    width: 100%;
    border-collapse: collapse;
  }

  .table thead {
    background: var(--color-bg-secondary);
  }

  .table th {
    text-align: left;
    padding: var(--space-3) var(--space-4);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .table th:last-child {
    text-align: center;
  }

  .sort-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
    padding: 0;
    cursor: pointer;
  }

  .sort-arrow {
    font-size: 11px;
    line-height: 1;
    color: var(--color-text-tertiary);
  }

  .table td {
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--color-border);
  }

  .table td:last-child {
    text-align: center;
  }

  .empty-filtered-cell {
    text-align: center;
    color: var(--color-text-secondary);
    padding: var(--space-6) var(--space-4);
  }


  .table tbody tr {
    transition: background 0.2s;
  }

  .table tbody tr:hover {
    background: var(--color-bg-secondary);
  }

  .date-main {
    font-weight: 500;
    color: var(--color-text-primary);
  }

  .version-badge {
    display: inline-block;
    margin-top: var(--space-1);
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-warning) 18%, var(--color-bg-primary));
    color: var(--color-warning-dark, #92400e);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .patient-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .patient-cf {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .badge {
    display: inline-block;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .badge-prima-visita {
    background: #dbeafe;
    color: #1e40af;
  }

  .badge-controllo {
    background: #d1fae5;
    color: #065f46;
  }

  .badge-urgenza {
    background: #fee2e2;
    color: #991b1b;
  }

  .badge-consulto {
    background: #e0e7ff;
    color: #3730a3;
  }

  .truncate {
    display: block;
    max-width: 200px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .text-muted {
    color: var(--color-text-tertiary);
  }

  .actions {
    display: flex;
    gap: var(--space-2);
    justify-content: center;
  }

  .btn-icon {
    background: none;
    border: none;
    font-size: var(--text-xl);
    cursor: pointer;
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    transition: all 0.2s;
  }

  .btn-icon:hover {
    background: var(--color-bg-tertiary);
    transform: scale(1.1);
  }

  .btn-icon:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    transform: none;
  }

  .btn-icon:disabled:hover {
    background: none;
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

  @media (max-width: 1100px) {
    .filters-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 768px) {
    .page-header {
      flex-direction: column;
      gap: var(--space-4);
    }

    .filters-grid {
      grid-template-columns: 1fr;
    }

  }
</style>
