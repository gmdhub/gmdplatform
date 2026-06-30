<script lang="ts">
  import { fhUntreatedLdlOptions } from '$lib/configs/clinical-options';
  import type { FHRiskClassification, UntreatedLdlRange } from '$lib/db/types';
  import { getDutchLipidScoreBreakdown } from '$lib/utils/dutch-lipid-score';
  import Card from '../Card.svelte';
  import Icon from '../Icon.svelte';
  import SectionTitle from '../SectionTitle.svelte';

  export let enabled = false;
  export let familyHistoryOnePoint = false;
  export let familyHistoryTwoPoints = false;
  export let clinicalPrematureCAD = false;
  export let clinicalPrematureCerebralOrPeripheral = false;
  export let physicalTendonXanthomas = false;
  export let physicalCornealArcusBefore45 = false;
  export let untreatedLdlRange: UntreatedLdlRange = '';
  export let geneticMutation = false;
  export let totalScore = 0;
  export let classification: FHRiskClassification = 'Improbabile';

  let breakdown = {
    familyHistory: 0,
    clinicalHistory: 0,
    physicalExam: 0,
    untreatedLdl: 0,
    genetics: 0,
    total: 0,
    classification: 'Improbabile' as FHRiskClassification
  };
  let canShowOutcome = false;

  $: if (!enabled) {
    familyHistoryOnePoint = false;
    familyHistoryTwoPoints = false;
    clinicalPrematureCAD = false;
    clinicalPrematureCerebralOrPeripheral = false;
    physicalTendonXanthomas = false;
    physicalCornealArcusBefore45 = false;
    untreatedLdlRange = '';
    geneticMutation = false;
    breakdown = {
      familyHistory: 0,
      clinicalHistory: 0,
      physicalExam: 0,
      untreatedLdl: 0,
      genetics: 0,
      total: 0,
      classification: 'Improbabile'
    };
    totalScore = 0;
    classification = 'Improbabile';
  } else {
    breakdown = getDutchLipidScoreBreakdown({
      enabled,
      familyHistoryOnePoint,
      familyHistoryTwoPoints,
      clinicalPrematureCAD,
      clinicalPrematureCerebralOrPeripheral,
      physicalTendonXanthomas,
      physicalCornealArcusBefore45,
      untreatedLdlRange,
      geneticMutation,
      totalScore: 0,
      classification: 'Improbabile'
    });

    totalScore = breakdown.total;
    classification = breakdown.classification;
  }

  $: canShowOutcome = enabled && !!untreatedLdlRange;

  function getClassificationTone(value: FHRiskClassification): string {
    if (value === 'Definita') return 'critical';
    if (value === 'Probabile') return 'strong';
    if (value === 'Possibile') return 'medium';
    return 'light';
  }

  const ldlCheckboxOptions = fhUntreatedLdlOptions.filter(
    (option): option is { value: Exclude<UntreatedLdlRange, ''>; label: string } => option.value !== ''
  );

  function toggleLdlRange(value: Exclude<UntreatedLdlRange, ''>) {
    untreatedLdlRange = untreatedLdlRange === value ? '' : value;
  }
</script>

<Card>
  <div class="section-header">
    <div class="title-wrap">
      <SectionTitle title="Ipercolesterolemia Familiare (FH)">
        <label class="toggle-label">
          <input type="checkbox" bind:checked={enabled} />
          <span>Attiva calcolo</span>
        </label>
      </SectionTitle>
      <p class="section-subtitle">
        Valutazione Dutch Lipid Clinic Network.
      </p>
    </div>
  </div>

  {#if enabled}
    <div class="fh-layout">
      <div class="areas-stack">
        <section class="area-card">
          <div class="area-header">
            <div>
              <h3 class="area-title">1. Storia familiare</h3>
              <p class="area-note">Se presenti piu' criteri, conta il punteggio piu' alto dell'area.</p>
            </div>
            <span class="area-score">{breakdown.familyHistory} pt</span>
          </div>

          <div class="criteria-list">
            <label class="criteria-row">
              <input type="checkbox" bind:checked={familyHistoryOnePoint} />
              <span class="criteria-text">
                Parente di I grado con malattia coronarica o vascolare prematura
                (uomo &lt;55 anni, donna &lt;60 anni) oppure con LDL &gt;95o percentile
              </span>
              <span class="points-pill">1 pt</span>
            </label>

            <label class="criteria-row">
              <input type="checkbox" bind:checked={familyHistoryTwoPoints} />
              <span class="criteria-text">
                Parente di I grado con xantomi tendinei e/o arco corneale, oppure figlio/a
                &lt;18 anni con LDL &gt;95o percentile
              </span>
              <span class="points-pill">2 pt</span>
            </label>
          </div>
        </section>

        <section class="area-card">
          <div class="area-header">
            <div>
              <h3 class="area-title">2. Storia clinica personale</h3>
              <p class="area-note">Conta il criterio con punteggio maggiore all'interno dell'area.</p>
            </div>
            <span class="area-score">{breakdown.clinicalHistory} pt</span>
          </div>

          <div class="criteria-list">
            <label class="criteria-row">
              <input type="checkbox" bind:checked={clinicalPrematureCAD} />
              <span class="criteria-text">
                Coronaropatia prematura personale (uomo &lt;55 anni, donna &lt;60 anni)
              </span>
              <span class="points-pill">2 pt</span>
            </label>

            <label class="criteria-row">
              <input type="checkbox" bind:checked={clinicalPrematureCerebralOrPeripheral} />
              <span class="criteria-text">
                Malattia cerebrovascolare o arteriopatia periferica prematura personale
                (uomo &lt;55 anni, donna &lt;60 anni)
              </span>
              <span class="points-pill">1 pt</span>
            </label>
          </div>
        </section>

        <section class="area-card">
          <div class="area-header">
            <div>
              <h3 class="area-title">3. Esame obiettivo</h3>
              <p class="area-note">Per i segni clinici viene considerato il valore piu' alto.</p>
            </div>
            <span class="area-score">{breakdown.physicalExam} pt</span>
          </div>

          <div class="criteria-list">
            <label class="criteria-row">
              <input type="checkbox" bind:checked={physicalTendonXanthomas} />
              <span class="criteria-text">Xantomi tendinei</span>
              <span class="points-pill">6 pt</span>
            </label>

            <label class="criteria-row">
              <input type="checkbox" bind:checked={physicalCornealArcusBefore45} />
              <span class="criteria-text">Arco corneale prima dei 45 anni</span>
              <span class="points-pill">4 pt</span>
            </label>
          </div>
        </section>

        <section class="area-card">
          <div class="area-header">
            <div>
              <h3 class="area-title">4. Profilo lipidico</h3>
        <p class="area-note">Seleziona una sola fascia di LDL non trattato. La scelta e' obbligatoria.</p>
            </div>
            <span class="area-score">{breakdown.untreatedLdl} pt</span>
          </div>

          <div class="criteria-list">
            {#each ldlCheckboxOptions as option}
              <label class="criteria-row">
                <input
                  type="checkbox"
                  checked={untreatedLdlRange === option.value}
                  on:change={() => toggleLdlRange(option.value)}
                />
                <span class="criteria-text">LDL non trattato {option.label}</span>
                <span class="points-pill">
                  {option.value === '155-189'
                    ? '1 pt'
                    : option.value === '190-249'
                      ? '3 pt'
                      : option.value === '250-329'
                        ? '5 pt'
                        : '8 pt'}
                </span>
              </label>
            {/each}
          </div>
        </section>

        <section class="area-card">
          <div class="area-header">
            <div>
              <h3 class="area-title">5. Genetica</h3>
              <p class="area-note">Mutazione causativa documentata per FH.</p>
            </div>
            <span class="area-score">{breakdown.genetics} pt</span>
          </div>

          <div class="criteria-list criteria-list-single">
            <label class="criteria-row">
              <input type="checkbox" bind:checked={geneticMutation} />
              <span class="criteria-text">Mutazione genetica documentata (LDLR, APOB, PCSK9)</span>
              <span class="points-pill">8 pt</span>
            </label>
          </div>
        </section>
      </div>

      <aside class="summary-panel">
        <div class="summary-header">
          <span class="summary-kicker">Riepilogo</span>
          <h3 class="summary-title">Dutch Lipid Score</h3>
        </div>

        <div class="summary-list">
          <div class="summary-row">
            <span>Storia familiare</span>
            <strong>{breakdown.familyHistory}</strong>
          </div>
          <div class="summary-row">
            <span>Storia clinica</span>
            <strong>{breakdown.clinicalHistory}</strong>
          </div>
          <div class="summary-row">
            <span>Esame obiettivo</span>
            <strong>{breakdown.physicalExam}</strong>
          </div>
          <div class="summary-row">
            <span>LDL non trattato</span>
            <strong>{breakdown.untreatedLdl}</strong>
          </div>
          <div class="summary-row">
            <span>Genetica</span>
            <strong>{breakdown.genetics}</strong>
          </div>
        </div>

        {#if canShowOutcome}
          <div class="total-box">
            <span class="total-label">Totale</span>
            <strong class="total-value">{totalScore}</strong>
          </div>

          <div class="classification-box classification-{getClassificationTone(classification)}">
            <span class="classification-label">Classificazione</span>
            <strong class="classification-value">{classification}</strong>
          </div>
        {:else}
          <div class="summary-warning" role="status">
            <span class="summary-warning-icon" aria-hidden="true">
              <Icon name="alert-triangle" size={18} />
            </span>
            <span class="summary-warning-text">
              Compilare prima il profilo lipidico per visualizzare totale e classificazione.
            </span>
          </div>
        {/if}
      </aside>
    </div>
  {/if}
</Card>

<style>
  .section-header {
    display: block;
    margin-bottom: var(--space-5);
  }

  .title-wrap {
    min-width: 0;
  }

  .section-subtitle {
    margin: 0;
    padding-top: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: 1.5;
  }

  .toggle-label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-bg-secondary);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text);
    cursor: pointer;
  }

  .fh-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.8fr) minmax(260px, 0.9fr);
    gap: var(--space-5);
    align-items: start;
  }

  .areas-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .area-card {
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0)),
      var(--color-bg);
  }

  .area-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .area-title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 700;
    color: var(--color-text);
  }

  .area-note {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: 1.5;
  }

  .area-score {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 58px;
    padding: 6px 10px;
    border-radius: 999px;
    background: rgba(30, 58, 138, 0.08);
    color: var(--color-primary);
    font-size: var(--text-sm);
    font-weight: 700;
  }

  .criteria-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .criteria-list-single {
    gap: 0;
  }

  .criteria-row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-bg-secondary);
    cursor: pointer;
  }

  .criteria-text {
    font-size: var(--text-sm);
    color: var(--color-text);
    line-height: 1.45;
  }

  .points-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 48px;
    padding: 4px 8px;
    border-radius: 999px;
    background: rgba(34, 211, 238, 0.12);
    color: #0f766e;
    font-size: 12px;
    font-weight: 700;
  }

  .summary-panel {
    position: sticky;
    top: var(--space-4);
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    background:
      radial-gradient(circle at top right, rgba(34, 211, 238, 0.16), transparent 42%),
      linear-gradient(180deg, rgba(30, 58, 138, 0.03), transparent 55%),
      var(--color-bg);
  }

  .summary-header {
    margin-bottom: var(--space-4);
  }

  .summary-kicker {
    display: inline-block;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-primary);
  }

  .summary-title {
    margin: var(--space-1) 0 0;
    font-size: var(--text-lg);
    font-weight: 700;
    color: var(--color-text);
  }

  .summary-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .summary-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    border-bottom: 1px dashed var(--color-border);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .summary-row strong {
    font-size: var(--text-base);
  }

  .total-box,
  .classification-box {
    margin-top: var(--space-4);
    padding: var(--space-4);
    border-radius: var(--radius-lg);
  }

  .total-box {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    background: var(--color-bg-secondary);
  }

  .total-label,
  .classification-label {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .total-value {
    font-size: 2rem;
    line-height: 1;
    font-weight: 800;
    color: var(--color-text);
  }

  .classification-box {
    border: 1px solid transparent;
  }

  .classification-light {
    background: rgba(148, 163, 184, 0.14);
    border-color: rgba(148, 163, 184, 0.2);
  }

  .classification-medium {
    background: rgba(250, 204, 21, 0.14);
    border-color: rgba(234, 179, 8, 0.2);
  }

  .classification-strong {
    background: rgba(249, 115, 22, 0.14);
    border-color: rgba(234, 88, 12, 0.2);
  }

  .classification-critical {
    background: rgba(239, 68, 68, 0.14);
    border-color: rgba(220, 38, 38, 0.2);
  }

  .classification-value {
    display: block;
    margin-top: var(--space-1);
    font-size: var(--text-lg);
    font-weight: 800;
    color: var(--color-text);
  }

  .summary-warning {
    margin-top: var(--space-4);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4);
    border-radius: var(--radius-lg);
    border: 1px solid rgba(234, 179, 8, 0.22);
    background: rgba(250, 204, 21, 0.14);
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: 1.5;
    color: #92400e;
  }

  .summary-warning-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 20px;
    height: 20px;
    color: #d97706;
  }

  .summary-warning-icon :global(.icon-svg) {
    display: block;
    width: 100%;
    height: 100%;
  }

  .summary-warning-text {
    flex: 1 1 auto;
  }

  @media (max-width: 960px) {
    .fh-layout {
      grid-template-columns: 1fr;
    }

    .summary-panel {
      position: static;
    }

  }

  @media (max-width: 640px) {
    .criteria-row {
      grid-template-columns: auto 1fr;
    }

    .points-pill {
      grid-column: 2;
      justify-self: start;
    }
  }
</style>
