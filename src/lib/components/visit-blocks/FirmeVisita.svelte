<script lang="ts">
  import type { FirmeVisita as FirmeVisitaValue } from '$lib/db/types';
  import Card from '../Card.svelte';
  import Input from '../Input.svelte';
  import SectionTitle from '../SectionTitle.svelte';

  export let firme: FirmeVisitaValue = {
    cardiologoNome: '',
    cardiologoTitolo: 'dott',
    mediciInFormazione: [{ nome: '', titolo: 'dott' }]
  };

  $: if (!firme.mediciInFormazione.length) {
    firme = {
      ...firme,
      mediciInFormazione: [{ nome: '', titolo: 'dott' }]
    };
  }

  function updateCardiologoTitolo(titolo: 'dott' | 'dott.ssa') {
    firme = {
      ...firme,
      cardiologoTitolo: titolo
    };
  }

  function updateMedicoInFormazioneTitolo(index: number, titolo: 'dott' | 'dott.ssa') {
    const next = [...firme.mediciInFormazione];
    next[index] = {
      ...next[index],
      titolo
    };

    firme = {
      ...firme,
      mediciInFormazione: next
    };
  }

  function addMedicoInFormazione() {
    firme = {
      ...firme,
      mediciInFormazione: [...firme.mediciInFormazione, { nome: '', titolo: 'dott' }]
    };
  }

  function removeMedicoInFormazione(index: number) {
    const next = firme.mediciInFormazione.filter((_, currentIndex) => currentIndex !== index);

    firme = {
      ...firme,
      mediciInFormazione: next.length > 0 ? next : [{ nome: '', titolo: 'dott' }]
    };
  }
</script>

<Card>
  <SectionTitle title="Firme" />

  <div class="signature-group">
    <label class="group-label" for="firma-cardiologo">Il Cardiologo</label>
    <div class="person-row">
      <div class="title-choice" role="radiogroup" aria-label="Titolo cardiologo">
        <label class="radio-option">
          <input
            type="radio"
            name="firma-cardiologo-titolo"
            checked={firme.cardiologoTitolo === 'dott'}
            on:change={() => updateCardiologoTitolo('dott')}
          />
          <span>Dott.</span>
        </label>
        <label class="radio-option">
          <input
            type="radio"
            name="firma-cardiologo-titolo"
            checked={firme.cardiologoTitolo === 'dott.ssa'}
            on:change={() => updateCardiologoTitolo('dott.ssa')}
          />
          <span>Dott.ssa</span>
        </label>
      </div>
      <div class="person-name">
        <Input
          id="firma-cardiologo"
          type="text"
          bind:value={firme.cardiologoNome}
          placeholder="Nome del cardiologo"
        />
      </div>
    </div>
  </div>

  <div class="signature-group">
    <div class="group-header">
      <span class="group-label">Il medico in formazione</span>
      <button
        type="button"
        class="add-btn"
        aria-label="Aggiungi medico in formazione"
        title="Aggiungi medico in formazione"
        on:click={addMedicoInFormazione}
      >
        +
      </button>
    </div>

    <div class="trainees-list">
      {#each firme.mediciInFormazione as medico, index}
        <div class="trainee-row">
          <div class="person-row trainee-input">
            <div class="title-choice" role="radiogroup" aria-label={`Titolo specializzando ${index + 1}`}>
              <label class="radio-option">
                <input
                  type="radio"
                  name={`firma-specializzando-titolo-${index}`}
                  checked={medico.titolo === 'dott'}
                  on:change={() => updateMedicoInFormazioneTitolo(index, 'dott')}
                />
                <span>Dott.</span>
              </label>
              <label class="radio-option">
                <input
                  type="radio"
                  name={`firma-specializzando-titolo-${index}`}
                  checked={medico.titolo === 'dott.ssa'}
                  on:change={() => updateMedicoInFormazioneTitolo(index, 'dott.ssa')}
                />
                <span>Dott.ssa</span>
              </label>
            </div>
            <div class="person-name">
              <Input
                id={`firma-specializzando-${index}`}
                type="text"
                bind:value={firme.mediciInFormazione[index].nome}
                placeholder="Nome dello specializzando"
              />
            </div>
          </div>

          {#if firme.mediciInFormazione.length > 1}
            <button
              type="button"
              class="remove-btn"
              on:click={() => removeMedicoInFormazione(index)}
            >
              Rimuovi
            </button>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</Card>

<style>
  .signature-group + .signature-group {
    margin-top: var(--space-5);
  }

  .person-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .group-label {
    display: block;
    margin-bottom: var(--space-3);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text);
  }

  .group-header .group-label {
    margin-bottom: 0;
  }

  .add-btn,
  .remove-btn {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-secondary);
    color: var(--color-text);
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
  }

  .add-btn {
    width: 34px;
    height: 34px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-lg);
    line-height: 1;
  }

  .remove-btn {
    padding: 8px 10px;
    min-width: 84px;
  }

  .trainees-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .trainee-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .trainee-input {
    flex: 1 1 auto;
  }

  .person-name {
    flex: 1 1 auto;
  }

  .title-choice {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    min-width: 146px;
  }

  .radio-option {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text);
    white-space: nowrap;
    cursor: pointer;
  }

  .radio-option input {
    margin: 0;
    accent-color: var(--color-primary);
  }

  @media (max-width: 768px) {
    .group-header,
    .trainee-row,
    .person-row {
      align-items: stretch;
      flex-direction: column;
    }

    .title-choice {
      min-width: 0;
    }
  }
</style>
