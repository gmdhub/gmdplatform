<script lang="ts">
  import { tick } from 'svelte';
  import { rischioCVOptions, statinaDoseOptions } from '$lib/configs/clinical-options';
  import type {
    EsamiEmaticiValues,
    TerapiaIpolipemizzante,
    ValutazioneRischioCardiovascolare
  } from '$lib/db/types';
  import {
    buildLdlTherapyRecommendation,
    createDefaultLdlTherapyManualSelection,
    type LdlCombinationClassKey,
    type LdlTherapyManualSelection,
    type LdlTherapyRecommendation,
    normalizeRischioCVLevel,
    normalizeValutazioneRischioCV
  } from '$lib/utils/visit-clinical';
  import Card from '../Card.svelte';
  import SectionTitle from '../SectionTitle.svelte';

  export let valutazione: ValutazioneRischioCardiovascolare;
  export let esami: EsamiEmaticiValues;
  export let terapia: TerapiaIpolipemizzante;
  export let eta: number | null = null;

  const RISK_CV_DEBUG = true;
  const REQUIRE_THERAPY_IN_DEV = import.meta.env.DEV;
  let lastEffectiveDebugSnapshot = '';
  let lastDomDebugSnapshot = '';
  let effectiveValutazione = normalizeValutazioneRischioCV(valutazione, esami);
  let statusHeadline = 'Seleziona il rischio cardiovascolare';
  let statusTone: 'success' | 'danger' | 'warning' = 'warning';
  let statusColor = '#92400e';
  let statusStyle = `color: ${statusColor} !important; -webkit-text-fill-color: ${statusColor} !important;`;
  let statusValueEl: HTMLElement | null = null;
  let metricValueEl: HTMLElement | null = null;
  let recommendation: LdlTherapyRecommendation | null = null;
  let therapySelection: LdlTherapyManualSelection = createDefaultLdlTherapyManualSelection();
  let classSelection: Record<LdlCombinationClassKey, boolean> = {
    statin: false,
    ezetimibe: false,
    bempedoicAcid: false,
    pcsk9i: false
  };
  const classOrder: LdlCombinationClassKey[] = ['statin', 'ezetimibe', 'bempedoicAcid', 'pcsk9i'];
  let hasAtLeastOneClassSelected = false;
  let missingSelectionWarnings: string[] = [];
  let canShowEstimatedCombination = false;

  $: effectiveValutazione = normalizeValutazioneRischioCV(valutazione, esami);
  $: {
    if (REQUIRE_THERAPY_IN_DEV && (!terapia || typeof terapia !== 'object')) {
      throw new Error(
        '[RISK-CV] Prop `terapia` obbligatoria: passare sempre terapiaIpolipemizzante dal chiamante.'
      );
    }
  }
  $: recommendation =
    terapia && typeof terapia === 'object'
      ? buildLdlTherapyRecommendation(effectiveValutazione, terapia, {
          selection: therapySelection,
          patientAge: eta
        })
      : null;
  $: hasAtLeastOneClassSelected = Object.values(classSelection).some(Boolean);
  $: {
    const nextWarnings: string[] = [];
    if (classSelection.statin && !therapySelection.statinDose) {
      nextWarnings.push('Seleziona un dosaggio per la statina.');
    }
    if (classSelection.pcsk9i && !therapySelection.pcsk9i) {
      nextWarnings.push('Seleziona un principio attivo PCSK9i.');
    }
    missingSelectionWarnings = nextWarnings;
  }
  $: canShowEstimatedCombination =
    hasAtLeastOneClassSelected &&
    missingSelectionWarnings.length === 0 &&
    Boolean(recommendation?.selectedCombination);
  $: {
    if (effectiveValutazione.status === 'raggiunto') {
      statusHeadline = 'Target raggiunto';
      statusTone = 'success';
      statusColor = '#047857';
    } else if (effectiveValutazione.status === 'non_raggiunto') {
      statusHeadline = 'Target NON raggiunto';
      statusTone = 'danger';
      statusColor = '#b91c1c';
    } else if (normalizeRischioCVLevel(effectiveValutazione.rischio)) {
      statusHeadline = 'Inserire LDL diretto o LDL calcolato';
      statusTone = 'warning';
      statusColor = '#92400e';
    } else {
      statusHeadline = 'Seleziona il rischio cardiovascolare';
      statusTone = 'warning';
      statusColor = '#92400e';
    }

    statusStyle = `color: ${statusColor} !important; -webkit-text-fill-color: ${statusColor} !important;`;
  }
  $: {
    if (RISK_CV_DEBUG) {
      const snapshot = [
        normalizeRischioCVLevel(effectiveValutazione.rischio),
        effectiveValutazione.status,
        statusHeadline,
        String(effectiveValutazione.ldlAttuale ?? 'null'),
        String(effectiveValutazione.targetLdl ?? 'null'),
        String(esami.ldl_diretto || ''),
        String(esami.ldl_calcolato || '')
      ].join('|');

      if (snapshot !== lastEffectiveDebugSnapshot) {
        lastEffectiveDebugSnapshot = snapshot;
        console.info('[RISK-CV][BLOCK] effectiveValutazione update', {
          displayedSelectValue: normalizeRischioCVLevel(effectiveValutazione.rischio),
          rischio: effectiveValutazione.rischio,
          status: effectiveValutazione.status,
          statusMessage: effectiveValutazione.statusMessage,
          statusHeadline,
          ldlAttuale: effectiveValutazione.ldlAttuale,
          targetLdl: effectiveValutazione.targetLdl,
          ldlDirettoInput: esami.ldl_diretto,
          ldlCalcolatoInput: esami.ldl_calcolato
        });
      }
    }
  }
  $: {
    if (RISK_CV_DEBUG) {
      const snapshot = [
        statusHeadline,
        normalizeRischioCVLevel(effectiveValutazione.rischio),
        effectiveValutazione.status,
        String(effectiveValutazione.targetLdl ?? 'null')
      ].join('|');

      if (snapshot !== lastDomDebugSnapshot) {
        lastDomDebugSnapshot = snapshot;
        void tick().then(() => {
          const computed = statusValueEl ? window.getComputedStyle(statusValueEl) : null;
          console.info('[RISK-CV][BLOCK] dom render snapshot', {
            domStatusValue: statusValueEl?.textContent?.trim() || null,
            domTargetValue: metricValueEl?.textContent?.trim() || null,
            expectedStatusColor: statusColor,
            inlineStatusColor: statusValueEl?.style.color || null,
            inlineWebkitTextFillColor:
              (statusValueEl?.style as CSSStyleDeclaration | undefined)?.webkitTextFillColor || null,
            computedStatusColor: computed?.color || null,
            computedWebkitTextFillColor:
              (computed as CSSStyleDeclaration | null)?.webkitTextFillColor || null,
            computedStatusHeadline: statusHeadline,
            computedStatusMessage: effectiveValutazione.statusMessage,
            computedStatus: effectiveValutazione.status,
            computedRischio: normalizeRischioCVLevel(effectiveValutazione.rischio),
            computedTargetLdl: effectiveValutazione.targetLdl
          });
        });
      }
    }
  }

  function handleRiskChange(event: Event) {
    const target = event.currentTarget as HTMLSelectElement;
    const nextRisk = normalizeRischioCVLevel(target.value);
    const {
      targetLdl: _previousTargetLdl,
      status: _previousStatus,
      statusMessage: _previousStatusMessage,
      ...baseValutazione
    } = valutazione;
    const nextValutazione = normalizeValutazioneRischioCV(
      {
        ...baseValutazione,
        rischio: nextRisk
      },
      esami
    );
    if (RISK_CV_DEBUG) {
      console.info('[RISK-CV][BLOCK] handleRiskChange', {
        rawSelectValue: target.value,
        normalizedSelectValue: nextRisk,
        previousRischio: valutazione?.rischio,
        nextRischio: nextValutazione.rischio,
        nextStatus: nextValutazione.status,
        nextStatusMessage: nextValutazione.statusMessage,
        ldlDirettoInput: esami.ldl_diretto,
        ldlCalcolatoInput: esami.ldl_calcolato
      });
    }
    valutazione = nextValutazione;
    if (RISK_CV_DEBUG) {
      console.info('[RISK-CV][BLOCK] post-change valutazione', {
        rischio: valutazione.rischio,
        status: valutazione.status,
        statusMessage: valutazione.statusMessage,
        statusHeadline,
        ldlAttuale: valutazione.ldlAttuale,
        targetLdl: valutazione.targetLdl
      });
    }
  }

  function formatLdlValue(value: number | null): string {
    if (value === null) {
      return 'Non disponibile';
    }

    return `${new Intl.NumberFormat('it-IT', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1
    }).format(value)} mg/dL`;
  }

  function formatPercentValue(value: number | null): string {
    if (value === null) {
      return '--';
    }

    return `${new Intl.NumberFormat('it-IT', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1
    }).format(value)}%`;
  }

  function getFinalStatusLabel(value: LdlTherapyRecommendation['finalStatus']): string {
    if (value === 'raggiunto') {
      return 'Target stimato raggiunto';
    }

    if (value === 'non_raggiunto') {
      return 'Target stimato non raggiunto';
    }

    return 'Stima non disponibile';
  }

  function handleClassToggle(
    key: LdlCombinationClassKey,
    event: Event
  ): void {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    classSelection = {
      ...classSelection,
      [key]: enabled
    };

    if (!enabled) {
      therapySelection = {
        ...therapySelection,
        ...(key === 'statin' ? { statinDose: '' } : {}),
        ...(key === 'ezetimibe' ? { ezetimibe: false } : {}),
        ...(key === 'bempedoicAcid' ? { bempedoicAcid: false } : {}),
        ...(key === 'pcsk9i' ? { pcsk9i: '' } : {})
      };
      return;
    }

    if (key === 'ezetimibe') {
      therapySelection = {
        ...therapySelection,
        ezetimibe: true
      };
      return;
    }

    if (key === 'bempedoicAcid') {
      therapySelection = {
        ...therapySelection,
        bempedoicAcid: true
      };
    }
  }

  function hasActiveClassBefore(target: LdlCombinationClassKey): boolean {
    const targetIndex = classOrder.indexOf(target);
    if (targetIndex <= 0) {
      return false;
    }

    return classOrder.slice(0, targetIndex).some((key) => classSelection[key]);
  }

  function isSelectionMissingWarning(warning: string | null): boolean {
    return Boolean(warning && warning.startsWith('Seleziona almeno un principio attivo'));
  }

</script>

<Card>
  <div class="section-shell">
    <SectionTitle title="Valutazione Rischio Cardiovascolare" />

    <div class="risk-board">
      <div class="board-segment board-select">
        <label for="rischio-cv" class="field-label">Rischio CV</label>
        <select
          id="rischio-cv"
          value={normalizeRischioCVLevel(effectiveValutazione.rischio)}
          on:change={handleRiskChange}
        >
          <option value="" disabled>Seleziona il rischio CV del paziente...</option>
          {#each rischioCVOptions as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>

      <div class="board-segment board-metric">
        <span class="metric-label">Target LDL-C</span>
        <strong class="metric-value" bind:this={metricValueEl}>
          {#if effectiveValutazione.targetLdl !== null}
            &lt;{effectiveValutazione.targetLdl} mg/dL
          {:else}
            --
          {/if}
        </strong>
      </div>

      <div class="board-segment board-status status-{statusTone}">
        <span class="metric-label">A target</span>
        <strong class="status-value" style={statusStyle} bind:this={statusValueEl}>
          {statusHeadline}
        </strong>
      </div>
    </div>
  </div>

  <div class="detail-strip">
    <div class="detail-item">
      <span class="detail-label">LDL corrente</span>
      <strong class="detail-value">{formatLdlValue(effectiveValutazione.ldlAttuale)}</strong>
    </div>
    {#if recommendation}
      <div class="detail-item">
        <span class="detail-label">LDL originale stimata</span>
        <strong class="detail-value">{formatLdlValue(recommendation.estimatedOriginalLdl)}</strong>
      </div>
    {/if}
  </div>

  {#if recommendation}
    <div class="recommendation-panel">
      <div class="recommendation-header">
        <h3 class="recommendation-title">Suggerimento terapeutico per target LDL</h3>
        <p class="recommendation-note">
          Supporto decisionale: non sostituisce valutazione clinica, tollerabilita, controindicazioni e preferenze del paziente.
        </p>
      </div>

      <div class="prescribable-classes-panel">
        <p class="prescribable-classes-title">Classi prescrivibili</p>
        <div class="prescribable-classes-grid">
          <label class="prescribable-checkbox">
            <input
              type="checkbox"
              checked={classSelection.statin}
              on:change={(event) => handleClassToggle('statin', event)}
            />
            <span>Statine</span>
          </label>
          <label class="prescribable-checkbox">
            <input
              type="checkbox"
              checked={classSelection.ezetimibe}
              on:change={(event) => handleClassToggle('ezetimibe', event)}
            />
            <span>Ezetimibe</span>
          </label>
          <label class="prescribable-checkbox">
            <input
              type="checkbox"
              checked={classSelection.bempedoicAcid}
              on:change={(event) => handleClassToggle('bempedoicAcid', event)}
            />
            <span>Acido bempedoico</span>
          </label>
          <label class="prescribable-checkbox">
            <input
              type="checkbox"
              checked={classSelection.pcsk9i}
              on:change={(event) => handleClassToggle('pcsk9i', event)}
            />
            <span>PCSK9i</span>
          </label>
        </div>
        <p class="prescribable-note">
          Attiva le classi desiderate e scegli principio attivo/dose nella riga sotto.
        </p>
      </div>

      <div class="combination-builder-panel">
        <p class="prescribable-classes-title">Regime selezionato</p>
        {#if hasAtLeastOneClassSelected}
          <div class="combination-builder-row">
            {#if classSelection.statin}
              {#if hasActiveClassBefore('statin')}
                <span class="combination-plus">+</span>
              {/if}
              <select
                class="combination-select"
                aria-label="Selezione statina"
                value={therapySelection.statinDose}
                on:change={(event) =>
                  (therapySelection = {
                    ...therapySelection,
                    statinDose: (event.currentTarget as HTMLSelectElement).value
                  })}
              >
                <option value="">Seleziona statina</option>
                {#each statinaDoseOptions as option}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
            {/if}

            {#if classSelection.ezetimibe}
              {#if hasActiveClassBefore('ezetimibe')}
                <span class="combination-plus">+</span>
              {/if}
              <select
                class="combination-select"
                aria-label="Selezione ezetimibe"
                value={therapySelection.ezetimibe ? 'ezetimibe' : ''}
                on:change={(event) =>
                  (therapySelection = {
                    ...therapySelection,
                    ezetimibe: (event.currentTarget as HTMLSelectElement).value === 'ezetimibe'
                  })}
              >
                <option value="ezetimibe">Ezetimibe 10 mg/die</option>
              </select>
            {/if}

            {#if classSelection.bempedoicAcid}
              {#if hasActiveClassBefore('bempedoicAcid')}
                <span class="combination-plus">+</span>
              {/if}
              <select
                class="combination-select"
                aria-label="Selezione acido bempedoico"
                value={therapySelection.bempedoicAcid ? 'bempedoico' : ''}
                on:change={(event) =>
                  (therapySelection = {
                    ...therapySelection,
                    bempedoicAcid: (event.currentTarget as HTMLSelectElement).value === 'bempedoico'
                  })}
              >
                <option value="bempedoico">Acido bempedoico 180 mg/die</option>
              </select>
            {/if}

            {#if classSelection.pcsk9i}
              {#if hasActiveClassBefore('pcsk9i')}
                <span class="combination-plus">+</span>
              {/if}
              <select
                class="combination-select"
                aria-label="Selezione PCSK9i"
                value={therapySelection.pcsk9i}
                on:change={(event) =>
                  (therapySelection = {
                    ...therapySelection,
                    pcsk9i: (event.currentTarget as HTMLSelectElement).value as
                      | ''
                      | 'repatha'
                      | 'praluent'
                      | 'leqvio'
                  })}
              >
                <option value="">Seleziona PCSK9i</option>
                <option value="repatha">Repatha (evolocumab)</option>
                <option value="praluent">Praluent (alirocumab)</option>
                <option value="leqvio">Leqvio (inclisiran)</option>
              </select>
            {/if}

            <span class="combination-output">
              LDL stimata:
              <strong>
                {#if canShowEstimatedCombination && recommendation?.selectedCombination}
                  {formatLdlValue(recommendation.selectedCombination.estimatedLdl)}
                {:else}
                  --
                {/if}
              </strong>
            </span>
          </div>

          {#if canShowEstimatedCombination && recommendation.selectedCombination}
            <p class="combination-reduction">
              Riduzione totale stimata: {formatPercentValue(recommendation.selectedCombination.totalReductionPct)}
            </p>
            <div class="source-badges">
              {#each recommendation.selectedCombination.sourceIds as combinationSourceId}
                <span class="source-badge">{combinationSourceId}</span>
              {/each}
            </div>
          {/if}
        {:else}
          <p class="combination-placeholder">
            Seleziona almeno una classe di farmaco per costruire il regime.
          </p>
        {/if}
      </div>

      {#if missingSelectionWarnings.length > 0}
        <p class="selection-warning">{missingSelectionWarnings.join(' ')}</p>
      {/if}

      {#if recommendation.warning && !isSelectionMissingWarning(recommendation.warning)}
        <p class="recommendation-warning">{recommendation.warning}</p>
      {/if}

      <details class="sources-details">
        <summary>Fonti cliniche ({recommendation.sources.length})</summary>
        <ul class="sources-list">
          {#each recommendation.sources as source}
            <li class="source-item">
              <div class="source-item-head">
                <span class="source-id">{source.id}</span>
                <a href={source.url} target="_blank" rel="noopener noreferrer">{source.shortLabel}</a>
              </div>
              <p class="source-citation">{source.citation}</p>
              <small class="source-review-date">Aggiornato al {source.lastReviewed}</small>
            </li>
          {/each}
        </ul>
      </details>
    </div>
  {/if}
</Card>

<style>
  .section-shell {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .risk-board {
    display: grid;
    grid-template-columns: minmax(210px, 1.2fr) minmax(150px, 0.8fr) minmax(200px, 1fr);
    gap: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    overflow: hidden;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0)),
      var(--color-bg-secondary);
  }

  .board-segment {
    min-height: 106px;
    padding: var(--space-4);
  }

  .board-segment + .board-segment {
    border-left: 1px solid var(--color-border);
  }

  .board-select {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-2);
  }

  .field-label,
  .metric-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--color-text-secondary);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  select {
    width: 100%;
    height: 38px;
    padding: 0 var(--space-4);
    font-size: var(--text-base);
    font-family: var(--font-sans);
    color: var(--color-text);
    background-color: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-sizing: border-box;
  }

  select:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px rgba(30, 58, 138, 0.1);
  }

  .board-metric {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 6px;
    background: rgba(30, 58, 138, 0.04);
  }

  .metric-value {
    font-size: clamp(1rem, 2vw, 1.35rem);
    line-height: 1.1;
    font-weight: 800;
    color: var(--color-text);
  }

  .board-status {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
  }

  .status-value {
    font-size: clamp(1.25rem, 2.6vw, 1.8rem);
    line-height: 1;
    font-weight: 900;
    letter-spacing: -0.02em;
  }

  .status-success {
    background: linear-gradient(180deg, rgba(16, 185, 129, 0.14), rgba(16, 185, 129, 0.08));
  }

  .status-success .status-value {
    color: #047857;
  }

  .status-danger {
    background: linear-gradient(180deg, rgba(239, 68, 68, 0.14), rgba(239, 68, 68, 0.08));
  }

  .status-danger .status-value {
    color: #b91c1c;
  }

  .status-warning {
    background: linear-gradient(180deg, rgba(250, 204, 21, 0.18), rgba(250, 204, 21, 0.1));
  }

  .status-warning .status-value {
    color: #92400e;
  }

  .detail-strip {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin-top: var(--space-2);
    padding: 0;
    background: none;
  }

  .detail-item {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }

  .detail-label {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .detail-value {
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .recommendation-panel {
    margin-top: var(--space-4);
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-bg-secondary);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .recommendation-header {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .recommendation-title {
    margin: 0;
    font-size: var(--text-lg);
    color: var(--color-text);
  }

  .recommendation-note {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    line-height: 1.35;
  }

  .prescribable-classes-panel {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .prescribable-classes-title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--color-text);
  }

  .prescribable-classes-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .prescribable-checkbox {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 0 var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-secondary);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .prescribable-checkbox input[type='checkbox'] {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--color-primary);
  }

  .prescribable-note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: 1.35;
  }

  .combination-builder-panel {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .combination-builder-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }

  .combination-select {
    width: auto;
    min-width: 190px;
    max-width: 260px;
    min-height: 34px;
    font-size: var(--text-sm);
  }

  .combination-plus {
    font-size: var(--text-base);
    font-weight: 700;
    color: var(--color-text-secondary);
  }

  .combination-output {
    margin-left: auto;
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .combination-output strong {
    color: var(--color-text);
  }

  .combination-placeholder {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .selection-warning {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: rgba(250, 204, 21, 0.15);
    border: 1px solid rgba(250, 204, 21, 0.35);
    color: #92400e;
    font-size: var(--text-sm);
  }

  .recommendation-metrics {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .recommendation-metric-item {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg);
    padding: var(--space-2) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .recommendation-metric-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-secondary);
    font-weight: 700;
  }

  .recommendation-warning {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: rgba(239, 68, 68, 0.09);
    border: 1px solid rgba(239, 68, 68, 0.25);
    color: #b91c1c;
    font-size: var(--text-sm);
  }

  .combinations-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .combination-item {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg);
    padding: var(--space-2) var(--space-3);
  }

  .combination-head {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: baseline;
  }

  .combination-label {
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .combination-ldl {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .combination-reduction {
    margin: 4px 0 var(--space-1) 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .source-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .source-badge {
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    font-size: 11px;
    color: var(--color-text-secondary);
    font-weight: 600;
  }

  .sources-details {
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-2);
  }

  .sources-details summary {
    cursor: pointer;
    color: var(--color-primary);
    font-weight: 600;
  }

  .sources-list {
    margin: var(--space-2) 0 0 0;
    padding-left: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .source-item {
    color: var(--color-text);
  }

  .source-item-head {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
    flex-wrap: wrap;
  }

  .source-id {
    font-size: 11px;
    font-weight: 700;
    color: var(--color-text-secondary);
    border: 1px solid var(--color-border);
    border-radius: 999px;
    padding: 1px 6px;
    background: var(--color-bg);
  }

  .source-citation {
    margin: 4px 0;
    font-size: var(--text-sm);
    line-height: 1.35;
    color: var(--color-text);
  }

  .source-review-date {
    color: var(--color-text-secondary);
    font-size: 11px;
  }

  @media (max-width: 840px) {
    .risk-board {
      grid-template-columns: 1fr;
    }

    .board-segment + .board-segment {
      border-left: none;
      border-top: 1px solid var(--color-border);
    }

    .board-segment {
      min-height: 0;
    }

    .recommendation-metrics {
      grid-template-columns: 1fr;
    }

    .prescribable-classes-grid {
      grid-template-columns: 1fr;
    }

    .combination-output {
      margin-left: 0;
    }
  }

  @media (max-width: 640px) {
    .detail-strip {
      align-items: baseline;
      flex-direction: row;
    }
  }
</style>
