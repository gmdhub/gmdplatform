<script lang="ts">
  import Card from '../Card.svelte';
  import Input from '../Input.svelte';
  import SectionTitle from '../SectionTitle.svelte';
  import Textarea from '../Textarea.svelte';

  type EcocardiografiaValues = {
    [key: string]: string;
    vs_dtd: string;
    vs_siv: string;
    vs_pp: string;
    vs_rwt: string;
    vs_fe: string;
    vd_rvd1: string;
    vd_tapse: string;
    vd_s_prime: string;
    as_a4c: string;
    as_lavi: string;
    ad_a4c: string;
    ao_lvot: string;
    ao_radice: string;
    ao_giunto: string;
    ao_ascendente: string;
    ao_arco: string;
    ao_discendente: string;
    ao_addominale: string;
    va_vmax: string;
    va_gmax: string;
    va_gmed: string;
    va_pht: string;
    va_ava_vti: string;
    va_ava_plan: string;
    vm_gmed: string;
    vm_pisar: string;
    vm_eroa: string;
    vt_gmax: string;
    vt_vmax: string;
    vci: string;
    referto: string;
  };

  type EcocardiografiaItem = {
    key: keyof EcocardiografiaValues;
    label: string;
    unit: string;
    computed?: boolean;
  };

  type EcocardiografiaSection = {
    title: string;
    items: EcocardiografiaItem[];
  };

  export let eco: EcocardiografiaValues = {
    vs_dtd: '',
    vs_siv: '',
    vs_pp: '',
    vs_rwt: '',
    vs_fe: '',
    vd_rvd1: '',
    vd_tapse: '',
    vd_s_prime: '',
    as_a4c: '',
    as_lavi: '',
    ad_a4c: '',
    ao_lvot: '',
    ao_radice: '',
    ao_giunto: '',
    ao_ascendente: '',
    ao_arco: '',
    ao_discendente: '',
    ao_addominale: '',
    va_vmax: '',
    va_gmax: '',
    va_gmed: '',
    va_pht: '',
    va_ava_vti: '',
    va_ava_plan: '',
    vm_gmed: '',
    vm_pisar: '',
    vm_eroa: '',
    vt_gmax: '',
    vt_vmax: '',
    vci: '',
    referto: ''
  };

  const sections: EcocardiografiaSection[] = [
    {
      title: 'Ventricolo sinistro',
      items: [
        { key: 'vs_dtd', label: 'DTD', unit: 'mm' },
        { key: 'vs_siv', label: 'SIV', unit: 'mm' },
        { key: 'vs_pp', label: 'PP', unit: 'mm' },
        { key: 'vs_rwt', label: 'RWT', unit: '', computed: true },
        { key: 'vs_fe', label: 'FE', unit: '%' }
      ]
    },
    {
      title: 'Ventricolo destro',
      items: [
        { key: 'vd_rvd1', label: 'RVD1', unit: 'mm' },
        { key: 'vd_tapse', label: 'TAPSE', unit: 'mm' },
        { key: 'vd_s_prime', label: "S'", unit: 'cm/s' }
      ]
    },
    {
      title: 'Atrio sinistro',
      items: [
        { key: 'as_a4c', label: 'A4C', unit: 'cm^2' },
        { key: 'as_lavi', label: 'LAVi', unit: 'ml/m^2' }
      ]
    },
    {
      title: 'Atrio destro',
      items: [
        { key: 'ad_a4c', label: 'A4C', unit: 'cm^2' }
      ]
    },
    {
      title: 'Aorta',
      items: [
        { key: 'ao_lvot', label: 'LVOT', unit: 'mm' },
        { key: 'ao_radice', label: 'Radice aortica', unit: 'mm' },
        { key: 'ao_giunto', label: 'Giunzione seno-tubulare', unit: 'mm' },
        { key: 'ao_ascendente', label: 'Ascendente', unit: 'mm' },
        { key: 'ao_arco', label: 'Arco', unit: 'mm' },
        { key: 'ao_discendente', label: 'Discendente', unit: 'mm' },
        { key: 'ao_addominale', label: 'Addominale', unit: 'mm' }
      ]
    },
    {
      title: 'Valvola aortica',
      items: [
        { key: 'va_vmax', label: 'Vmax', unit: 'm/s' },
        { key: 'va_gmax', label: 'Gmax', unit: 'mmHg' },
        { key: 'va_gmed', label: 'Gmed', unit: 'mmHg' },
        { key: 'va_pht', label: 'PHT', unit: 'ms' },
        { key: 'va_ava_vti', label: 'AVA VTI', unit: 'cm^2' },
        { key: 'va_ava_plan', label: 'AVA planimetrica', unit: 'cm^2' }
      ]
    },
    {
      title: 'Valvola mitrale',
      items: [
        { key: 'vm_gmed', label: 'Gmed', unit: 'mmHg' },
        { key: 'vm_pisar', label: 'PISA r', unit: 'mm' },
        { key: 'vm_eroa', label: 'EROA', unit: 'cm^2' }
      ]
    },
    {
      title: 'Valvola tricuspide',
      items: [
        { key: 'vt_gmax', label: 'Gmax', unit: 'mmHg' },
        { key: 'vt_vmax', label: 'Vmax', unit: 'm/s' }
      ]
    },
    {
      title: 'VCI',
      items: [
        { key: 'vci', label: 'VCI', unit: 'mm' }
      ]
    }
  ];

  function getItemLabel(item: EcocardiografiaItem): string {
    return item.unit ? `${item.label} (${item.unit})` : item.label;
  }

  const decimalPattern = '^[0-9]*(?:[.,][0-9]{0,2})?$';

  function toNumber(value: string): number | null {
    if (value === null || value === undefined) return null;
    const normalized = value.toString().replace(',', '.').trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatNumber(value: number, decimals = 2): string {
    if (!Number.isFinite(value)) return '';
    return value.toFixed(decimals);
  }

  function computeRwt(): string {
    const dtd = toNumber(eco.vs_dtd);
    const pp = toNumber(eco.vs_pp);
    if (dtd === null || dtd <= 0 || pp === null || pp <= 0) return '';
    const rwt = (2 * pp) / dtd;
    return formatNumber(rwt, 2);
  }

  $: {
    const nextRwt = computeRwt();
    if (eco.vs_rwt !== nextRwt) {
      eco = { ...eco, vs_rwt: nextRwt };
    }
  }
</script>

<Card>
  <SectionTitle title="Ecocardiografia" />

  {#each sections as section}
    <div class="eco-section">
      <h3 class="section-subtitle">{section.title}</h3>
      <div class="measure-grid">
        {#each section.items as item}
          <div class="measure-item">
            <Input
              id={`eco_${item.key}`}
              type="text"
              inputmode="decimal"
              pattern={decimalPattern}
              label={getItemLabel(item)}
              bind:value={eco[item.key]}
              disabled={Boolean(item.computed)}
              placeholder={item.computed ? 'Calcolato automaticamente' : 'Inserisci valore'}
            />
          </div>
        {/each}
      </div>
    </div>
  {/each}

  <div class="eco-section referto-section">
    <Textarea
      id="eco_referto"
      label="Referto"
      bind:value={eco.referto}
      placeholder="Inserisci il referto ecocardiografico..."
      rows={6}
    />
  </div>
</Card>

<style>
  .section-subtitle {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text);
    margin: var(--space-4) 0 var(--space-2) 0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .eco-section:first-of-type .section-subtitle {
    margin-top: 0;
  }

  .measure-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-4);
  }

  .measure-item :global(.input-group) {
    display: grid;
    grid-template-columns: max-content minmax(90px, 120px);
    align-items: center;
    column-gap: var(--space-2);
    row-gap: var(--space-1);
  }

  .measure-item :global(.label) {
    margin: 0;
    max-width: 160px;
    white-space: normal;
    line-height: 1.2;
  }

  .measure-item :global(input[type='number']) {
    -moz-appearance: textfield;
    appearance: textfield;
  }

  .measure-item :global(input[type='number']::-webkit-inner-spin-button),
  .measure-item :global(input[type='number']::-webkit-outer-spin-button) {
    -webkit-appearance: none;
    margin: 0;
  }

  .referto-section {
    margin-top: var(--space-6);
  }

  @media (max-width: 640px) {
    .measure-item :global(.input-group) {
      grid-template-columns: 1fr;
    }
  }
</style>
