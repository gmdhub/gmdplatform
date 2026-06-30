<script lang="ts">
  import {
    bempedoicoDose,
    ezetimibeModeOptions,
    fibratiDoseOptions,
    leqvioDoseOptions,
    omega3DoseOptions,
    praluentDoseOptions,
    repathaDoseOptions,
    statinaDoseOptions
  } from '$lib/configs/clinical-options';
  import type {
    DoseSelection,
    EzetimibeSelection,
    StatinaSelection,
    TerapiaIpolipemizzante as TerapiaIpolipemizzanteModel
  } from '$lib/db/types';
  import { createEmptyTerapiaIpolipemizzante } from '$lib/utils/visit-clinical';
  import Card from '../Card.svelte';
  import SectionTitle from '../SectionTitle.svelte';

  export let terapia: TerapiaIpolipemizzanteModel = createEmptyTerapiaIpolipemizzante();

  function updateDoseSelection(
    key: 'fibrati' | 'omega3' | 'acido_bempedoico' | 'repatha' | 'praluent' | 'leqvio',
    updates: Partial<DoseSelection>
  ) {
    terapia = {
      ...terapia,
      [key]: {
        ...terapia[key],
        ...updates
      }
    };
  }

  function updateStatine(updates: Partial<StatinaSelection>) {
    terapia = {
      ...terapia,
      statine: {
        ...terapia.statine,
        ...updates
      }
    };
  }

  function updateEzetimibe(updates: Partial<EzetimibeSelection>) {
    terapia = {
      ...terapia,
      ezetimibe: {
        ...terapia.ezetimibe,
        ...updates
      }
    };
  }

  function handleToggleStatine(event: Event) {
    const enabled = (event.currentTarget as HTMLInputElement).checked;

    if (!enabled) {
      updateStatine({
        enabled: false,
        dose: ''
      });
      return;
    }

    updateStatine({ enabled: true });
  }

  function handleToggleEzetimibe(event: Event) {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    updateEzetimibe({
      enabled,
      modalita: enabled ? terapia.ezetimibe.modalita : ''
    });
  }

  function handleToggleDoseSelection(
    key: 'fibrati' | 'omega3' | 'repatha' | 'praluent' | 'leqvio',
    event: Event
  ) {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    updateDoseSelection(key, {
      enabled,
      dose: enabled ? terapia[key].dose : ''
    });
  }

  function handleToggleBempedoico(event: Event) {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    updateDoseSelection('acido_bempedoico', {
      enabled,
      dose: enabled ? bempedoicoDose : ''
    });
  }
</script>

<Card>
  <SectionTitle title="Terapia Ipolipemizzante" />

  <div class="therapy-list">
    <div class="therapy-item">
      <label class="checkbox-row">
        <input type="checkbox" checked={terapia.statine.enabled} on:change={handleToggleStatine} />
        <span>Statine</span>
      </label>
      {#if terapia.statine.enabled}
        <div class="therapy-fields">
          <div class="field-group field-group-full">
            <label for="statina-dose">Statina e dosaggio</label>
            <select
              id="statina-dose"
              value={terapia.statine.dose}
              on:change={(event) =>
                updateStatine({ dose: (event.currentTarget as HTMLSelectElement).value })}
            >
              <option value="">Seleziona statina e dosaggio</option>
              {#each statinaDoseOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </div>
        </div>
      {/if}
    </div>

    <div class="therapy-item">
      <label class="checkbox-row">
        <input type="checkbox" checked={terapia.ezetimibe.enabled} on:change={handleToggleEzetimibe} />
        <span>Ezetimibe</span>
      </label>
      {#if terapia.ezetimibe.enabled}
        <div class="therapy-fields">
          <div class="field-group field-group-full">
            <label for="ezetimibe-modalita">Modalita'</label>
            <select
              id="ezetimibe-modalita"
              value={terapia.ezetimibe.modalita}
              on:change={(event) =>
                updateEzetimibe({ modalita: (event.currentTarget as HTMLSelectElement).value })}
            >
              <option value="">Seleziona modalita'</option>
              {#each ezetimibeModeOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </div>
        </div>
      {/if}
    </div>

    <div class="therapy-item">
      <label class="checkbox-row">
        <input
          type="checkbox"
          checked={terapia.fibrati.enabled}
          on:change={(event) => handleToggleDoseSelection('fibrati', event)}
        />
        <span>Fibrati</span>
      </label>
      {#if terapia.fibrati.enabled}
        <div class="therapy-fields">
          <div class="field-group field-group-full">
            <label for="fibrati-dose">Dose</label>
            <select
              id="fibrati-dose"
              value={terapia.fibrati.dose}
              on:change={(event) =>
                updateDoseSelection('fibrati', { dose: (event.currentTarget as HTMLSelectElement).value })}
            >
              <option value="">Seleziona dose</option>
              {#each fibratiDoseOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </div>
        </div>
      {/if}
    </div>

    <div class="therapy-item">
      <label class="checkbox-row">
        <input
          type="checkbox"
          checked={terapia.omega3.enabled}
          on:change={(event) => handleToggleDoseSelection('omega3', event)}
        />
        <span>Omega 3</span>
      </label>
      {#if terapia.omega3.enabled}
        <div class="therapy-fields">
          <div class="field-group field-group-full">
            <label for="omega3-dose">Dose</label>
            <select
              id="omega3-dose"
              value={terapia.omega3.dose}
              on:change={(event) =>
                updateDoseSelection('omega3', { dose: (event.currentTarget as HTMLSelectElement).value })}
            >
              <option value="">Seleziona dose</option>
              {#each omega3DoseOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </div>
        </div>
      {/if}
    </div>

    <div class="therapy-item">
      <label class="checkbox-row">
        <input
          type="checkbox"
          checked={terapia.acido_bempedoico.enabled}
          on:change={handleToggleBempedoico}
        />
        <span>Acido Bempedoico</span>
      </label>
      {#if terapia.acido_bempedoico.enabled}
        <div class="static-dose">Dose fissa: {terapia.acido_bempedoico.dose}</div>
      {/if}
    </div>

    <div class="therapy-item">
      <label class="checkbox-row">
        <input
          type="checkbox"
          checked={terapia.repatha.enabled}
          on:change={(event) => handleToggleDoseSelection('repatha', event)}
        />
        <span>Repatha (Evolocumab)</span>
      </label>
      {#if terapia.repatha.enabled}
        <div class="therapy-fields">
          <div class="field-group field-group-full">
            <label for="repatha-dose">Dose</label>
            <select
              id="repatha-dose"
              value={terapia.repatha.dose}
              on:change={(event) =>
                updateDoseSelection('repatha', { dose: (event.currentTarget as HTMLSelectElement).value })}
            >
              <option value="">Seleziona dose</option>
              {#each repathaDoseOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </div>
        </div>
      {/if}
    </div>

    <div class="therapy-item">
      <label class="checkbox-row">
        <input
          type="checkbox"
          checked={terapia.praluent.enabled}
          on:change={(event) => handleToggleDoseSelection('praluent', event)}
        />
        <span>Praluent (Alirocumab)</span>
      </label>
      {#if terapia.praluent.enabled}
        <div class="therapy-fields">
          <div class="field-group field-group-full">
            <label for="praluent-dose">Dose</label>
            <select
              id="praluent-dose"
              value={terapia.praluent.dose}
              on:change={(event) =>
                updateDoseSelection('praluent', { dose: (event.currentTarget as HTMLSelectElement).value })}
            >
              <option value="">Seleziona dose</option>
              {#each praluentDoseOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </div>
        </div>
      {/if}
    </div>

    <div class="therapy-item">
      <label class="checkbox-row">
        <input
          type="checkbox"
          checked={terapia.leqvio.enabled}
          on:change={(event) => handleToggleDoseSelection('leqvio', event)}
        />
        <span>Leqvio (Inclisiran)</span>
      </label>
      {#if terapia.leqvio.enabled}
        <div class="therapy-fields">
          <div class="field-group field-group-full">
            <label for="leqvio-dose">Dose</label>
            <select
              id="leqvio-dose"
              value={terapia.leqvio.dose}
              on:change={(event) =>
                updateDoseSelection('leqvio', { dose: (event.currentTarget as HTMLSelectElement).value })}
            >
              <option value="">Seleziona dose</option>
              {#each leqvioDoseOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </div>
        </div>
      {/if}
    </div>
  </div>
</Card>

<style>
  .therapy-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .therapy-item {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-bg-secondary);
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text);
    font-weight: 500;
    cursor: pointer;
    min-width: 0;
  }

  .checkbox-row span {
    line-height: 1.35;
  }

  .therapy-fields {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-2);
    min-width: 0;
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field-group-full {
    grid-column: 1 / -1;
  }

  .field-group label {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text);
  }

  .field-group select {
    width: 100%;
    height: 34px;
    padding: 6px 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg);
    color: var(--color-text);
    font-size: var(--text-sm);
  }

  .field-group select:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px rgba(30, 58, 138, 0.1);
  }

  .field-group select:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .static-dose {
    font-size: var(--text-sm);
    color: var(--color-text);
    padding: 8px 10px;
    border-radius: var(--radius-md);
    background: var(--color-bg);
  }

  @media (max-width: 900px) {
    .therapy-list {
      grid-template-columns: 1fr;
    }
  }
</style>
