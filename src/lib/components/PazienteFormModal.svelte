<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import type { Paziente, CreatePazienteInput } from '$lib/db/types';
  import { createPaziente, updatePaziente } from '$lib/db/pazienti';
  import { toastStore } from '$lib/stores/toast';
  import Button from './Button.svelte';
  import Input from './Input.svelte';
  import Select from './Select.svelte';
  import Autocomplete from './Autocomplete.svelte';
  import Modal from './Modal.svelte';
  import { calcolaCodiceFiscale } from '$lib/utils/codiceFiscale';
  import type { AutocompleteItem } from '$lib/types/autocomplete';

  export let isOpen = false;
  export let paziente: Paziente | null = null;
  export let ambulatorioId: number;
  export let modalTitle: string | undefined = undefined;
  export let submitButtonLabel: string | undefined = undefined;
  export let requireChangesForSubmit = false;

  const dispatch = createEventDispatcher();

  // Dati per autocomplete
  let comuniData: AutocompleteItem[] = [];
  let statiData: AutocompleteItem[] = [];

  // Codici catastali per il calcolo CF
  let codiceCatastaleNascita = '';

  // Checkbox per esenzione
  let nessunaEsenzione = true;

  // Form fields
  let formData: CreatePazienteInput = createEmptyFormData(ambulatorioId);

  let formErrors: Record<string, string> = {};
  let initialFormSnapshot = '';
  let isFormDirty = false;
  let resolvedTitle = '';
  let resolvedSubmitButtonLabel = '';
  let canSubmit = true;
  let loadedFormContextKey = '';

  function createEmptyFormData(nextAmbulatorioId: number): CreatePazienteInput {
    return {
      ambulatorio_id: nextAmbulatorioId,
      nome: '',
      cognome: '',
      data_nascita: '',
      luogo_nascita: '',
      codice_fiscale: '',
      sesso: 'M',
      esenzioni: '',
      indirizzo: '',
      citta: '',
      cap: '',
      provincia: '',
      telefono: '',
      email: ''
    };
  }

  function serializeFormSnapshot(data: CreatePazienteInput): string {
    return JSON.stringify({
      ambulatorio_id: Number(data.ambulatorio_id || 0),
      nome: data.nome || '',
      cognome: data.cognome || '',
      data_nascita: data.data_nascita || '',
      luogo_nascita: data.luogo_nascita || '',
      codice_fiscale: data.codice_fiscale || '',
      sesso: data.sesso || 'Altro',
      esenzioni: data.esenzioni || '',
      indirizzo: data.indirizzo || '',
      citta: data.citta || '',
      cap: data.cap || '',
      provincia: data.provincia || '',
      telefono: data.telefono || '',
      email: data.email || ''
    });
  }

  $: resolvedTitle = modalTitle || (paziente ? 'Modifica Paziente' : 'Nuovo Paziente');
  $: resolvedSubmitButtonLabel = submitButtonLabel || (paziente ? 'Salva Modifiche' : 'Crea Paziente');
  $: isFormDirty = isOpen && initialFormSnapshot !== serializeFormSnapshot(formData);
  $: canSubmit = !requireChangesForSubmit || isFormDirty;

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

  // Inizializza il form solo quando il modal viene aperto o cambia il paziente target,
  // evitando reset continui mentre l'utente digita.
  $: {
    if (!isOpen) {
      loadedFormContextKey = '';
    } else {
      const contextKey = paziente ? `edit:${paziente.id}` : `new:${ambulatorioId}`;
      if (loadedFormContextKey !== contextKey) {
        loadedFormContextKey = contextKey;

        if (paziente) {
          nessunaEsenzione = !paziente.esenzioni || paziente.esenzioni.toLowerCase() === 'nessuno';
          formData = {
            ambulatorio_id: paziente.ambulatorio_id,
            nome: paziente.nome,
            cognome: paziente.cognome,
            data_nascita: paziente.data_nascita,
            luogo_nascita: paziente.luogo_nascita,
            codice_fiscale: paziente.codice_fiscale,
            sesso: paziente.sesso,
            esenzioni: (paziente.esenzioni && paziente.esenzioni.toLowerCase() !== 'nessuno') ? paziente.esenzioni : '',
            indirizzo: paziente.indirizzo || '',
            citta: paziente.citta || '',
            cap: paziente.cap || '',
            provincia: paziente.provincia || '',
            telefono: paziente.telefono || '',
            email: paziente.email || ''
          };
        } else {
          nessunaEsenzione = true;
          formData = createEmptyFormData(ambulatorioId);
        }

        initialFormSnapshot = serializeFormSnapshot(formData);
        formErrors = {};
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
    } catch (error) {
      console.error('Errore caricamento dati:', error);
    }
  });

  function validateForm(): boolean {
    formErrors = {};

    if (!formData.nome.trim()) formErrors.nome = 'Nome obbligatorio';
    if (!formData.cognome.trim()) formErrors.cognome = 'Cognome obbligatorio';
    if (!formData.data_nascita) formErrors.data_nascita = 'Data di nascita obbligatoria';
    if (!formData.luogo_nascita.trim()) formErrors.luogo_nascita = 'Luogo di nascita obbligatorio';
    if (!formData.codice_fiscale.trim()) formErrors.codice_fiscale = 'Codice fiscale obbligatorio';

    const normalizedTaxCode = formData.codice_fiscale.trim().toUpperCase();
    const isTemporaryCode =
      normalizedTaxCode.startsWith('TMP') || normalizedTaxCode.startsWith('DEVTMP');
    const isFiscalCode = normalizedTaxCode.length === 16;

    if (!isFiscalCode && !isTemporaryCode) {
      formErrors.codice_fiscale = 'Inserisci un codice fiscale valido (16 caratteri) o un codice temporaneo (TMP...)';
    }

    return Object.keys(formErrors).length === 0;
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

  async function handleSubmit() {
    if (!canSubmit) return;
    if (!validateForm()) {
      toastStore.show('error', 'Correggi i campi evidenziati per continuare');
      return;
    }

    try {
      let newPaziente;
      if (paziente) {
        await updatePaziente({ ...formData, id: paziente.id });
        newPaziente = { ...paziente, ...formData };
      } else {
        const id = await createPaziente(formData);
        newPaziente = { ...formData, id };
      }
      dispatch('submit', newPaziente);
      isOpen = false;
    } catch (error) {
      console.error('Errore salvataggio paziente:', error);
      const message = getErrorMessage(error);
      toastStore.show('error', `Errore salvataggio paziente: ${message}`);
      dispatch('error', { message, error });
    }
  }

  function handleClose() {
    dispatch('close');
    isOpen = false;
  }

  const sessoOptions = [
    { value: 'M', label: 'Maschio' },
    { value: 'F', label: 'Femmina' },
    { value: 'Altro', label: 'Altro' }
  ];
</script>

<Modal bind:open={isOpen} title={resolvedTitle} size="lg" on:close={handleClose}>
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
    <Button variant="secondary" on:click={handleClose}>
      Annulla
    </Button>
    <Button variant="primary" on:click={handleSubmit} disabled={!canSubmit}>
      {resolvedSubmitButtonLabel}
    </Button>
  </svelte:fragment>
</Modal>

<style>
  .paziente-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
  }

  .form-col {
    display: flex;
    flex-direction: column;
  }

  .form-col-full {
    grid-column: 1 / -1;
  }

  .form-col-sm {
    grid-column: span 1;
  }

  .form-section-title {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--color-text);
    margin: var(--space-4) 0 0 0;
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border);
  }

  .checkbox-group {
    margin-bottom: var(--space-3);
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .checkbox-label input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
  }

  @media (max-width: 768px) {
    .form-row {
      grid-template-columns: 1fr;
    }

    .form-col-sm {
      grid-column: 1;
    }
  }
</style>
