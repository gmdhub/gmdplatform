<script lang="ts">
  import { diabeteTipoOptions } from '$lib/configs/clinical-options';
  import type { DiabeteTipo } from '$lib/db/types';
  import Card from '../Card.svelte';
  import Icon from '../Icon.svelte';
  import SectionTitle from '../SectionTitle.svelte';

  export let bmi: number | null = null;

  // Dati del form
  export let familiarita = false;
  export let familiarita_note = '';
  export let ipertensione = false;
  export let diabete = false;
  export let diabete_durata = '';
  export let diabete_tipo: DiabeteTipo = '';
  export let dislipidemia = false;
  export let obesita = false;
  export let fumo = ''; // 'si', 'no', 'ex'
  export let fumo_ex_eta = ''; // età fino a cui ha fumato

  // Gestione checkbox fumo (solo uno può essere selezionato)
  let fumo_si = false;
  let fumo_no = false;
  let fumo_ex = false;

  $: {
    if (fumo === 'si') {
      fumo_si = true;
      fumo_no = false;
      fumo_ex = false;
    } else if (fumo === 'no') {
      fumo_si = false;
      fumo_no = true;
      fumo_ex = false;
    } else if (fumo === 'ex') {
      fumo_si = false;
      fumo_no = false;
      fumo_ex = true;
    }
  }

  function handleFumoChange(type: string) {
    if (type === 'si' && fumo_si) {
      fumo = 'si';
    } else if (type === 'no' && fumo_no) {
      fumo = 'no';
    } else if (type === 'ex' && fumo_ex) {
      fumo = 'ex';
    } else {
      fumo = '';
    }
  }

  // Calcola automaticamente obesità in base al BMI
  $: {
    if (bmi !== null && bmi >= 25) {
      obesita = true;
    }
  }

  $: if (!diabete) {
    diabete_durata = '';
    diabete_tipo = '';
  }

  // Calcola il testo dinamico per l'obesità in base al BMI
  function getBMILabel(bmi: number | null): string {
    if (bmi === null) return 'Obesità';
    if (bmi < 18.5) return 'Sottopeso';
    if (bmi < 25) return 'Normopeso';
    if (bmi < 30) return 'Sovrappeso';
    if (bmi < 35) return 'Obesità Classe I';
    if (bmi < 40) return 'Obesità Classe II';
    return 'Obesità Classe III';
  }

  $: bmiLabel = getBMILabel(bmi);
  $: showObesitaNote = bmi !== null && bmi >= 25;
</script>

<Card>
  <SectionTitle title="Fattori di Rischio Cardiovascolare" />

  <div class="risk-factors-compact">
    <!-- Riga 1: Familiarità con campo inline -->
    <div class="risk-row">
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={familiarita} />
        <span>Familiarità</span>
      </label>
      {#if familiarita}
        <input
          type="text"
          class="inline-input"
          bind:value={familiarita_note}
          placeholder="Specificare (es. Padre con infarto a 50 anni)"
        />
      {/if}
    </div>

    <!-- Riga 2: Ipertensione e Dislipidemia -->
    <div class="risk-row-double">
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={ipertensione} />
        <span>Ipertensione Arteriosa</span>
      </label>
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={dislipidemia} />
        <span>Dislipidemia</span>
      </label>
    </div>

    <!-- Riga 3: Diabete con durata inline -->
    <div class="risk-row">
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={diabete} />
        <span>Diabete Mellito</span>
      </label>
      {#if diabete}
        <div class="diabete-inline-group">
          <div class="radio-inline-group">
            {#each diabeteTipoOptions as option}
              <label class="radio-label">
                <input type="radio" bind:group={diabete_tipo} name="diabete_tipo" value={option.value} />
                <span>{option.label}</span>
              </label>
            {/each}
          </div>
          <input
            type="text"
            class="inline-input-small"
            bind:value={diabete_durata}
            placeholder="durata (es. 5 anni)"
          />
        </div>
      {/if}
    </div>

    <!-- Riga 4: Obesità e Fumo -->
    <div class="risk-row-double">
      <!-- Obesità -->
      <label class="checkbox-label obesita-label">
        <input type="checkbox" bind:checked={obesita} />
        <span>
          {bmiLabel}{bmi !== null ? ` (BMI ${bmi.toFixed(1)})` : ''}
          {#if showObesitaNote}
            <span class="info-tooltip-wrapper">
              <Icon name="info" size={14} className="info-icon" />
              <span class="tooltip-text">Questo campo è stato automaticamente selezionato perché il BMI del paziente è ≥25. Puoi deselezionarlo manualmente se necessario.</span>
            </span>
          {/if}
        </span>
      </label>

      <!-- Fumo -->
      <div class="fumo-group">
        <span class="fumo-label">Fumo:</span>
        <label class="checkbox-label fumo-checkbox">
          <input type="checkbox" bind:checked={fumo_si} on:change={() => handleFumoChange('si')} />
          <span>Sì</span>
        </label>
        <label class="checkbox-label fumo-checkbox">
          <input type="checkbox" bind:checked={fumo_no} on:change={() => handleFumoChange('no')} />
          <span>No</span>
        </label>
        <label class="checkbox-label fumo-checkbox">
          <input type="checkbox" bind:checked={fumo_ex} on:change={() => handleFumoChange('ex')} />
          <span>Ex</span>
        </label>
        {#if fumo === 'ex'}
          <input
            type="text"
            class="inline-input-small"
            bind:value={fumo_ex_eta}
            placeholder="fino a che età (es. 45 anni)"
          />
        {/if}
      </div>
    </div>
  </div>
</Card>

<style>
  .risk-factors-compact {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .risk-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .risk-row-double {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
  }

  .diabete-inline-group {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
    font-size: var(--text-base);
    color: var(--color-text);
    font-weight: 500;
    min-width: 180px;
  }

  .checkbox-label input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .obesita-label span {
    font-size: 16px;
    font-weight: 500;
  }

  .info-tooltip-wrapper {
    display: inline-flex;
    align-items: baseline;
    position: relative;
    vertical-align: super;
    font-size: 0.7em;
    margin-left: 2px;
  }

  .fumo-group {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .fumo-label {
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--color-text);
    margin-right: var(--space-1);
  }

  .fumo-checkbox {
    min-width: auto;
  }

  .radio-inline-group {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .radio-label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text);
    cursor: pointer;
  }

  .radio-label input[type='radio'] {
    margin: 0;
  }

  :global(.info-icon) {
    cursor: help;
    flex-shrink: 0;
    display: inline-block;
  }

  .tooltip-text {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-bottom: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background-color: var(--color-text);
    color: white;
    font-size: var(--text-xs);
    border-radius: var(--radius-md);
    white-space: normal;
    max-width: 280px;
    width: max-content;
    text-align: center;
    line-height: 1.4;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s;
    z-index: 10;
  }

  .tooltip-text::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 5px solid transparent;
    border-top-color: var(--color-text);
  }

  .info-tooltip-wrapper:hover .tooltip-text {
    opacity: 1;
  }

  .inline-input {
    flex: 1;
    min-width: 250px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-bg-primary);
    transition: all 0.2s;
  }

  .inline-input-small {
    width: 180px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-bg-primary);
    transition: all 0.2s;
  }

  .inline-input:focus,
  .inline-input-small:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  @media (max-width: 768px) {
    .risk-row-double {
      grid-template-columns: 1fr;
    }

    .checkbox-label {
      min-width: auto;
    }

    .inline-input {
      min-width: 100%;
    }
  }
</style>
