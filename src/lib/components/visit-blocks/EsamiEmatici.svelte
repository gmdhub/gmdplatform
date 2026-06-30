<script lang="ts">
  import type {
    EsameEmaticoKey,
    EsamiEmaticiValues,
    PreviousEsamiEmaticiMap
  } from '$lib/db/types';
  import Card from '../Card.svelte';
  import Input from '../Input.svelte';
  import SectionTitle from '../SectionTitle.svelte';

  type Sex = 'M' | 'F' | 'Altro';

  export let esami: EsamiEmaticiValues = {
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

  export let eta: number | null = null;
  export let peso: number | null = null;
  export let sesso: Sex | null = null;
  export let previousValues: PreviousEsamiEmaticiMap = {};

  const analytes: Array<{
    key: EsameEmaticoKey;
    label: string;
    unit: string;
    computed?: boolean;
  }> = [
    { key: 'hb', label: 'Hb', unit: 'g/dL' },
    { key: 'plt', label: 'PLT', unit: '10^3/uL' },
    { key: 'creatinina', label: 'Creatinina', unit: 'mg/dL' },
    { key: 'egfr', label: 'eGFR', unit: 'mL/min', computed: true },
    { key: 'colesterolo_totale', label: 'Colesterolo totale', unit: 'mg/dL' },
    { key: 'hdl', label: 'HDL', unit: 'mg/dL' },
    { key: 'trigliceridi', label: 'Trigliceridi', unit: 'mg/dL' },
    { key: 'ldl_calcolato', label: 'LDL calcolato', unit: 'mg/dL', computed: true },
    { key: 'ldl_diretto', label: 'LDL diretto', unit: 'mg/dL' },
    { key: 'lipoproteina_a', label: 'Lipoproteina a', unit: 'mg/dL' },
    { key: 'emoglobina_glicata', label: 'Emoglobina glicata (HbA1c)', unit: '%' },
    { key: 'glicemia', label: 'Glicemia', unit: 'mg/dL' },
    { key: 'ast', label: 'AST', unit: 'U/L' },
    { key: 'alt', label: 'ALT', unit: 'U/L' },
    { key: 'bilirubina_totale', label: 'Bilirubina totale', unit: 'mg/dL' },
    { key: 'cpk', label: 'CPK', unit: 'U/L' }
  ];

  function toNumber(value: string): number | null {
    if (value === null || value === undefined) return null;
    const normalized = value.toString().replace(',', '.').trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatNumber(value: number, decimals = 1): string {
    if (!Number.isFinite(value)) return '';
    return value.toFixed(decimals);
  }

  function computeEgfr(): string {
    const creatinina = toNumber(esami.creatinina);
    if (creatinina === null || creatinina <= 0) return '';
    if (eta === null || eta <= 0) return '';
    if (peso === null || peso <= 0) return '';
    const sexFactor = sesso === 'F' ? 0.85 : 1;
    const egfr = ((140 - eta) * peso * sexFactor) / (72 * creatinina);
    return formatNumber(egfr, 1);
  }

  function computeLdl(): string {
    const total = toNumber(esami.colesterolo_totale);
    const hdl = toNumber(esami.hdl);
    const trig = toNumber(esami.trigliceridi);
    if (total === null || hdl === null || trig === null) return '';
    const ldl = total - hdl - trig / 5;
    return formatNumber(ldl, 1);
  }

  function formatPreviousDate(date: string): string {
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) {
      return date;
    }

    return new Intl.DateTimeFormat('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(parsed);
  }

  function hasAnyCurrentValue(): boolean {
    return analytes.some((analyte) => String(esami[analyte.key] ?? '').trim().length > 0);
  }

  function handleAnalyteInput(key: EsameEmaticoKey, event: CustomEvent<string>): void {
    const nextValue = event.detail;
    esami = {
      ...esami,
      [key]: nextValue
    };
  }

  $: {
    const nextEgfr = computeEgfr();
    const nextLdl = computeLdl();
    if (esami.egfr !== nextEgfr || esami.ldl_calcolato !== nextLdl) {
      esami = { ...esami, egfr: nextEgfr, ldl_calcolato: nextLdl };
    }
  }
</script>

<Card>
  <SectionTitle title="Esami Ematici">
    <div class="esami-date-input">
      <Input
        id="esami_data_ee"
        type="date"
        bind:value={esami.data_ee}
      />
    </div>
  </SectionTitle>

  <div class="analiti-grid">
    {#each analytes as analyte}
      <div class="analyte-field">
        <Input
          id={`esami_${analyte.key}`}
          type="text"
          inputmode="decimal"
          pattern={'^[0-9]*[.,]?[0-9]{0,2}$'}
          label={analyte.label + ' (' + analyte.unit + ')'}
          bind:value={esami[analyte.key]}
          on:input={(event) => handleAnalyteInput(analyte.key, event)}
          disabled={analyte.computed || false}
          placeholder={analyte.computed ? 'Calcolato automaticamente' : 'Inserisci valore'}
        />

        {#if previousValues[analyte.key] && hasAnyCurrentValue()}
          <div class="previous-value">
            Ultimo valore: {previousValues[analyte.key]?.value} {analyte.unit} ({formatPreviousDate(previousValues[analyte.key]?.date || '')})
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <p class="esami-note">
    eGFR calcolato con Cockcroft-Gault, LDL calcolato con formula di Friedewald.
  </p>
</Card>

<style>
  .analiti-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: var(--space-4);
  }

  .esami-date-input {
    width: 170px;
    flex-shrink: 0;
  }

  .esami-date-input :global(.input-group) {
    gap: 0;
  }

  .analyte-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .previous-value {
    min-height: 18px;
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text-secondary);
  }

  .esami-note {
    margin-top: var(--space-4);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
</style>
