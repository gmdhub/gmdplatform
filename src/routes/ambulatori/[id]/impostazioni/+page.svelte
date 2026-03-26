<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { open } from '@tauri-apps/plugin-dialog';
  import { ambulatorioStore } from '$lib/stores/ambulatorio';
  import { authStore } from '$lib/stores/auth';
  import { sidebarCollapsedStore } from '$lib/stores/sidebar';
  import { toastStore } from '$lib/stores/toast';
  import {
    getAmbulatorioById,
    getAmbulatorioOperatingSettingsById,
    updateAmbulatorio,
    updateAmbulatorioOperatingSettings
  } from '$lib/db/ambulatori';
  import { getAllUsers, createUser, updateUser, deleteUser, verifyUserPassword, updateUserPassword } from '$lib/db/auth';
  import Card from '$lib/components/Card.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import Button from '$lib/components/Button.svelte';
  import Input from '$lib/components/Input.svelte';
  import UserFormModal from '$lib/components/UserFormModal.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import type { User, UpsertAmbulatorioOperatingWindowInput } from '$lib/db/types';
  import { ApiError } from '$lib/services/http-client';
  import {
    getDefaultDatabaseDirectory,
    getRuntimeDatabaseDirectory,
    getRuntimeDatabasePath,
    getRuntimeDatabaseUrl,
    isApiDataProvider
  } from '$lib/db/config';
  import { switchDatabaseDirectory } from '$lib/db/database-switch';
  import {
    clearReportBaseDirectory,
    getDefaultReportBaseDirectory,
    getReportBaseDirectory,
    setReportBaseDirectory
  } from '$lib/utils/report-storage';

  $: ambulatorio = $ambulatorioStore.current;
  $: user = $authStore.user;
  $: isAdmin = user?.role === 'admin';
  $: canEditOperatingSettings = user?.role === 'admin' || user?.role === 'medico';
  const apiMode = isApiDataProvider();

  let activeTab: 'ambulatorio' | 'utenti' | 'backup' | 'integrazioni' | 'sistema' = 'ambulatorio';
  let saving = false;

  // Gestione utenti
  let users: User[] = [];
  let loadingUsers = false;
  let showUserModal = false;
  let editingUser: User | null = null;
  let showDeleteModal = false;
  let userToDelete: User | null = null;
  let reportBaseDirectory = '';
  let defaultReportBaseDirectory = '';
  let loadingReportSettings = true;
  let databaseDirectory = '';
  let defaultDatabaseDirectory = '';
  let runtimeDatabasePath = '';
  let runtimeDatabaseUrl = '';
  let loadingDatabaseSettings = true;
  let switchingDatabaseDirectory = false;
  let loadingOperatingSettings = true;
  let savingOperatingSettings = false;
  let minVisitDurationMinutes = 10;
  let standardVisitDurationMinutes = 15;
  let operatingWindowsForm: Array<{
    uiId: string;
    weekday: number;
    ora_inizio: string;
    ora_fine: string;
    max_pazienti_giorno: number;
  }> = [];
  let operatingSettingsLoadedForAmbulatorioId = 0;

  // Dati form ambulatorio
  let formData = {
    nome: '',
    indirizzo: '',
    telefono: '',
    email: '',
    logo_path: '',
    color_primary: '#1e3a8a',
    color_secondary: '#3b82f6',
    color_accent: '#22d3ee'
  };

  const weekdayOptions = [
    { value: 1, label: 'Lunedì' },
    { value: 2, label: 'Martedì' },
    { value: 3, label: 'Mercoledì' },
    { value: 4, label: 'Giovedì' },
    { value: 5, label: 'Venerdì' },
    { value: 6, label: 'Sabato' },
    { value: 7, label: 'Domenica' }
  ];

  function createOperatingWindowUiId(): string {
    return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  function getDefaultMaxPatientsForWeekday(weekday: number): number {
    if (weekday === 1) {
      return 15;
    }
    if (weekday === 4) {
      return 25;
    }
    return 25;
  }

  $: if (ambulatorio) {
    formData.nome = ambulatorio.nome;
    formData.logo_path = ambulatorio.logo_path || '';
    formData.color_primary = ambulatorio.color_primary;
    formData.color_secondary = ambulatorio.color_secondary;
    formData.color_accent = ambulatorio.color_accent;
    formData.indirizzo = ambulatorio.indirizzo || '';
    formData.telefono = ambulatorio.telefono || '';
    formData.email = ambulatorio.email || '';
  }

  $: if (ambulatorio?.id && ambulatorio.id !== operatingSettingsLoadedForAmbulatorioId) {
    operatingSettingsLoadedForAmbulatorioId = ambulatorio.id;
    void loadOperatingSettingsForAmbulatorio(ambulatorio.id);
  }

  async function handleSaveAmbulatorio() {
    if (!ambulatorio) return;

    saving = true;
    try {
      await updateAmbulatorio(
        ambulatorio.id,
        formData.nome,
        formData.logo_path,
        formData.color_primary,
        formData.color_secondary,
        formData.color_accent,
        formData.indirizzo,
        formData.telefono,
        formData.email
      );

      // Ricarica ambulatorio aggiornato
      const updated = await getAmbulatorioById(ambulatorio.id);
      if (updated) {
        ambulatorioStore.select(updated);
      }

      toastStore.show('success', 'Impostazioni salvate con successo!');

      // Scroll in alto dopo il salvataggio
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      console.error('Errore salvataggio impostazioni:', error);
      toastStore.show('error', 'Errore durante il salvataggio delle impostazioni');
    } finally {
      saving = false;
    }
  }

  async function loadOperatingSettingsForAmbulatorio(ambulatorioId: number): Promise<void> {
    loadingOperatingSettings = true;
    try {
      const settings = await getAmbulatorioOperatingSettingsById(ambulatorioId);
      minVisitDurationMinutes = settings.durataMinimaVisitaMinuti;
      standardVisitDurationMinutes = settings.durataStandardVisitaMinuti;
      operatingWindowsForm = settings.windows.map((window) => ({
        uiId: createOperatingWindowUiId(),
        weekday: window.weekday,
        ora_inizio: window.ora_inizio,
        ora_fine: window.ora_fine,
        max_pazienti_giorno: Math.max(1, Number(window.max_pazienti_giorno || getDefaultMaxPatientsForWeekday(window.weekday)))
      }));
    } catch (error) {
      console.error('Errore caricamento orari ambulatorio:', error);
      toastStore.show('error', `Errore caricamento orari ambulatorio: ${getErrorMessage(error)}`);
      minVisitDurationMinutes = 10;
      standardVisitDurationMinutes = 15;
      operatingWindowsForm = [];
    } finally {
      loadingOperatingSettings = false;
    }
  }

  function addOperatingWindowRow(): void {
    operatingWindowsForm = [
      ...operatingWindowsForm,
      {
        uiId: createOperatingWindowUiId(),
        weekday: 1,
        ora_inizio: '08:00',
        ora_fine: '08:30',
        max_pazienti_giorno: getDefaultMaxPatientsForWeekday(1)
      }
    ];
  }

  function removeOperatingWindowRow(uiId: string): void {
    operatingWindowsForm = operatingWindowsForm.filter((window) => window.uiId !== uiId);
  }

  async function handleSaveOperatingSettings(): Promise<void> {
    if (!ambulatorio) {
      return;
    }

    if (!canEditOperatingSettings) {
      toastStore.show('error', 'Solo amministratori e medici possono modificare gli orari');
      return;
    }

    const payloadWindows: UpsertAmbulatorioOperatingWindowInput[] = operatingWindowsForm.map((window) => ({
      weekday: window.weekday as UpsertAmbulatorioOperatingWindowInput['weekday'],
      ora_inizio: window.ora_inizio,
      ora_fine: window.ora_fine,
      max_pazienti_giorno: Math.max(1, Math.floor(Number(window.max_pazienti_giorno || 0)))
    }));

    savingOperatingSettings = true;
    try {
      await updateAmbulatorioOperatingSettings({
        ambulatorioId: ambulatorio.id,
        durataMinimaVisitaMinuti: Math.floor(Number(minVisitDurationMinutes || 0)),
        durataStandardVisitaMinuti: Math.floor(Number(standardVisitDurationMinutes || 0)),
        windows: payloadWindows
      });

      const updated = await getAmbulatorioById(ambulatorio.id);
      if (updated) {
        ambulatorioStore.select(updated);
      }

      await loadOperatingSettingsForAmbulatorio(ambulatorio.id);
      toastStore.show('success', 'Orari ambulatorio aggiornati con successo');
    } catch (error) {
      console.error('Errore salvataggio orari ambulatorio:', error);
      const validationMessage = getApiValidationMessage(error);
      toastStore.show(
        'error',
        validationMessage ?? `Errore salvataggio orari ambulatorio: ${getErrorMessage(error)}`
      );
    } finally {
      savingOperatingSettings = false;
    }
  }

  async function loadUsers() {
    if (!isAdmin) return;

    loadingUsers = true;
    try {
      users = await getAllUsers();
    } catch (error) {
      console.error('Errore caricamento utenti:', error);
      toastStore.show('error', 'Errore durante il caricamento degli utenti');
    } finally {
      loadingUsers = false;
    }
  }

  function handleNewUser() {
    editingUser = null;
    showUserModal = true;
  }

  function handleEditUser(userToEdit: User) {
    editingUser = userToEdit;
    showUserModal = true;
  }

  async function handleUserSubmit(event: CustomEvent) {
    const data = event.detail;

    try {
      if (data.id) {
        // Modifica utente esistente
        await updateUser(data.id, data.username, data.role, data.nome, data.cognome);

        // Se vuole cambiare la password
        if (data.password && data.oldPassword) {
          // Verifica la vecchia password
          const isOldPasswordValid = await verifyUserPassword(data.id, data.oldPassword);
          if (!isOldPasswordValid) {
            toastStore.show('error', 'La vecchia password non è corretta');
            return;
          }

          // Aggiorna la password
          await updateUserPassword(data.id, data.password);
          toastStore.show('success', 'Utente e password modificati con successo!');
        } else {
          toastStore.show('success', 'Utente modificato con successo!');
        }
      } else {
        // Crea nuovo utente
        await createUser(data.username, data.password, data.role, data.nome, data.cognome);
        toastStore.show('success', 'Utente creato con successo!');
      }

      showUserModal = false;
      await loadUsers();
    } catch (error) {
      console.error('Errore salvataggio utente:', error);
      const validationMessage = getApiValidationMessage(error);
      toastStore.show(
        'error',
        validationMessage ?? `Errore durante il salvataggio dell'utente: ${getErrorMessage(error)}`
      );
    }
  }

  function openDeleteModal(userItem: User) {
    if (userItem.id === user?.id) {
      toastStore.show('error', 'Non puoi eliminare il tuo stesso account!');
      return;
    }
    userToDelete = userItem;
    showDeleteModal = true;
  }

  async function handleDeleteUser() {
    if (!userToDelete) return;

    try {
      await deleteUser(userToDelete.id);
      toastStore.show('success', 'Utente eliminato con successo!');
      await loadUsers();
      showDeleteModal = false;
      userToDelete = null;
    } catch (error) {
      console.error('Errore eliminazione utente:', error);
      toastStore.show('error', 'Errore durante l\'eliminazione dell\'utente');
    }
  }

  function getRoleBadge(role: string) {
    switch (role) {
      case 'admin': return { label: 'Amministratore', color: 'var(--color-error)' };
      case 'medico': return { label: 'Medico', color: 'var(--color-primary)' };
      case 'infermiere': return { label: 'Infermiere', color: 'var(--color-accent)' };
      default: return { label: role, color: 'var(--color-text-secondary)' };
    }
  }

  $: if (activeTab === 'utenti' && isAdmin) {
    loadUsers();
  }

  function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    if (typeof error === 'string' && error.trim()) {
      return error;
    }

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') {
        return serialized;
      }
    } catch {
      // ignore JSON serialization failures
    }

    return 'Errore sconosciuto';
  }

  function getApiValidationMessage(error: unknown): string | null {
    if (!(error instanceof ApiError) || error.status !== 400 || !error.payload || typeof error.payload !== 'object') {
      return null;
    }

    const payload = error.payload as Record<string, unknown>;
    const detailEntries: Array<Record<string, unknown>> = [];

    if (Array.isArray(payload.details)) {
      detailEntries.push(
        ...payload.details.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
      );
    } else if (payload.details && typeof payload.details === 'object') {
      const grouped = payload.details as Record<string, unknown>;
      for (const value of Object.values(grouped)) {
        if (Array.isArray(value)) {
          detailEntries.push(
            ...value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
          );
        }
      }
    }

    if (detailEntries.length === 0) {
      return null;
    }

    const first = detailEntries[0];
    const path = Array.isArray(first.path) ? first.path.map((segment) => String(segment)).join('.') : '';
    const message = typeof first.message === 'string' ? first.message : 'Valore non valido';

    return path ? `Errore validazione (${path}): ${message}` : `Errore validazione: ${message}`;
  }

  onMount(() => {
    loadSystemSettings();
  });

  async function loadSystemSettings() {
    await Promise.all([
      loadReportSettings(),
      loadDatabaseSettings()
    ]);
  }

  async function loadReportSettings() {
    loadingReportSettings = true;
    try {
      defaultReportBaseDirectory = await getDefaultReportBaseDirectory();
      reportBaseDirectory = await getReportBaseDirectory();
    } catch (error) {
      console.error('Errore caricamento impostazioni referti:', error);
      toastStore.show('error', 'Errore durante il caricamento della cartella referti');
    } finally {
      loadingReportSettings = false;
    }
  }

  async function loadDatabaseSettings() {
    loadingDatabaseSettings = true;
    try {
      defaultDatabaseDirectory = await getDefaultDatabaseDirectory();
      databaseDirectory = await getRuntimeDatabaseDirectory();
      runtimeDatabasePath = await getRuntimeDatabasePath();
      runtimeDatabaseUrl = await getRuntimeDatabaseUrl();
    } catch (error) {
      console.error('Errore caricamento impostazioni database:', error);
      toastStore.show('error', 'Errore durante il caricamento della cartella database');
    } finally {
      loadingDatabaseSettings = false;
    }
  }

  async function handleChooseReportDirectory() {
    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        defaultPath: reportBaseDirectory || defaultReportBaseDirectory,
        title: 'Seleziona cartella base referti'
      });

      if (typeof selectedPath !== 'string' || !selectedPath.trim()) {
        return;
      }

      reportBaseDirectory = selectedPath.trim();
      setReportBaseDirectory(reportBaseDirectory);
      toastStore.show('success', 'Cartella referti aggiornata con successo!');
    } catch (error) {
      console.error('Errore selezione cartella referti:', error);
      toastStore.show('error', 'Errore durante la selezione della cartella referti');
    }
  }

  async function handleChooseDatabaseDirectory() {
    if (!isAdmin || switchingDatabaseDirectory) {
      return;
    }

    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        defaultPath: databaseDirectory || defaultDatabaseDirectory,
        title: 'Seleziona cartella database'
      });

      if (typeof selectedPath !== 'string' || !selectedPath.trim()) {
        return;
      }

      databaseDirectory = selectedPath.trim();
    } catch (error) {
      console.error('Errore selezione cartella database:', error);
      toastStore.show('error', 'Errore durante la selezione della cartella database');
    }
  }

  function handleSaveReportDirectory() {
    if (!reportBaseDirectory.trim()) {
      toastStore.show('error', 'Inserisci un percorso valido per la cartella referti');
      return;
    }

    reportBaseDirectory = reportBaseDirectory.trim();
    setReportBaseDirectory(reportBaseDirectory);
    toastStore.show('success', 'Percorso cartella referti salvato!');
  }

  function handleResetReportDirectory() {
    clearReportBaseDirectory();
    reportBaseDirectory = defaultReportBaseDirectory;
    toastStore.show('success', 'Ripristinato il percorso predefinito dei referti');
  }

  async function handleApplyDatabaseDirectory() {
    if (!isAdmin) {
      toastStore.show('error', 'Solo gli amministratori possono cambiare la cartella database');
      return;
    }

    const nextDirectory = databaseDirectory.trim();
    if (!nextDirectory) {
      toastStore.show('error', 'Inserisci un percorso valido per la cartella database');
      return;
    }

    switchingDatabaseDirectory = true;
    try {
      const result = await switchDatabaseDirectory(nextDirectory);
      await loadDatabaseSettings();

      if (!result.changed) {
        toastStore.show('info', 'La cartella database selezionata è già quella attiva');
        return;
      }

      if (result.backupPath) {
        toastStore.show('success', `Cartella database aggiornata. Backup creato: ${result.backupPath}`);
      } else {
        toastStore.show('success', 'Cartella database aggiornata con successo');
      }
    } catch (error) {
      console.error('Errore cambio cartella database:', error);
      toastStore.show('error', `Errore durante il cambio cartella database: ${getErrorMessage(error)}`);
      await loadDatabaseSettings();
    } finally {
      switchingDatabaseDirectory = false;
    }
  }

  async function handleResetDatabaseDirectory() {
    if (!isAdmin) {
      toastStore.show('error', 'Solo gli amministratori possono cambiare la cartella database');
      return;
    }

    switchingDatabaseDirectory = true;
    try {
      const defaultDirectory = await getDefaultDatabaseDirectory();
      const result = await switchDatabaseDirectory(defaultDirectory);
      await loadDatabaseSettings();

      if (!result.changed) {
        toastStore.show('info', 'Il database sta già usando il percorso predefinito');
        return;
      }

      if (result.backupPath) {
        toastStore.show('success', `Ripristinato percorso predefinito database. Backup creato: ${result.backupPath}`);
      } else {
        toastStore.show('success', 'Ripristinato percorso predefinito database');
      }
    } catch (error) {
      console.error('Errore ripristino cartella database:', error);
      toastStore.show('error', `Errore durante il ripristino cartella database: ${getErrorMessage(error)}`);
      await loadDatabaseSettings();
    } finally {
      switchingDatabaseDirectory = false;
    }
  }

  function handleOpenDocumentationPlaceholder() {
    toastStore.show('info', 'Documentazione non ancora disponibile in questa versione.');
  }

  function handleOpenIssueTrackerPlaceholder() {
    toastStore.show('info', 'Issue tracker non ancora disponibile in questa versione.');
  }
</script>

<div class="impostazioni">
  <PageHeader
    title="Impostazioni"
    subtitle="Configurazione ambulatorio e sistema"
    showLogo={$sidebarCollapsedStore}
    onBack={() => goto(`/ambulatori/${ambulatorio?.id}`)}
  />

  <div class="tabs">
    <button
      class="tab"
      class:active={activeTab === 'ambulatorio'}
      on:click={() => activeTab = 'ambulatorio'}
    >
      <span class="tab-icon" aria-hidden="true">
        <Icon name="building" size={18} />
      </span>
      <span class="tab-label">Ambulatorio</span>
    </button>
    <button
      class="tab"
      class:active={activeTab === 'utenti'}
      on:click={() => activeTab = 'utenti'}
      disabled={!isAdmin}
      title={!isAdmin ? 'Solo amministratori possono accedere a questa sezione' : ''}
    >
      <span class="tab-icon" aria-hidden="true">
        <Icon name="users" size={18} />
      </span>
      <span class="tab-label">Utenti</span>
    </button>
    <button
      class="tab"
      class:active={activeTab === 'integrazioni'}
      on:click={() => activeTab = 'integrazioni'}
    >
      <span class="tab-icon" aria-hidden="true">
        <Icon name="link" size={18} />
      </span>
      <span class="tab-label">Integrazioni</span>
    </button>
    <button
      class="tab"
      class:active={activeTab === 'backup'}
      on:click={() => activeTab = 'backup'}
    >
      <span class="tab-icon" aria-hidden="true">
        <Icon name="hard-drive" size={18} />
      </span>
      <span class="tab-label">Backup</span>
    </button>
    <button
      class="tab"
      class:active={activeTab === 'sistema'}
      on:click={() => activeTab = 'sistema'}
    >
      <span class="tab-icon" aria-hidden="true">
        <Icon name="settings" size={18} />
      </span>
      <span class="tab-label">Sistema</span>
    </button>
  </div>

  <div class="tab-content">
    {#if activeTab === 'ambulatorio'}
      <Card padding="lg">
        <h2 class="section-title">Informazioni Ambulatorio</h2>

        <form on:submit|preventDefault={handleSaveAmbulatorio} class="settings-form">
          <Input
            id="nome"
            type="text"
            label="Nome Ambulatorio"
            bind:value={formData.nome}
            placeholder="Nome dell'ambulatorio"
          />

          <Input
            id="indirizzo"
            type="text"
            label="Indirizzo"
            bind:value={formData.indirizzo}
            placeholder="Via, Città, CAP"
          />

          <div class="form-row">
            <Input
              id="telefono"
              type="tel"
              label="Telefono"
              bind:value={formData.telefono}
              placeholder="+39 123 456 7890"
            />

            <Input
              id="email"
              type="email"
              label="Email"
              bind:value={formData.email}
              placeholder="ambulatorio@ospedale.it"
            />
          </div>

          <div class="form-group">
            <p class="form-group-title">Logo Ambulatorio</p>
            <div class="logo-upload">
              {#if formData.logo_path}
                <img src={formData.logo_path} alt="Logo" class="logo-preview" />
              {:else}
                <div class="logo-placeholder">Nessun logo</div>
              {/if}
              <button type="button" class="btn-secondary btn-with-icon">
                <Icon name="folder-open" size={18} />
                <span>Carica Logo</span>
              </button>
            </div>
          </div>

          <div class="form-group">
            <p class="form-group-title">Colori Tema</p>
            <div class="color-row">
              <div class="color-input">
                <label for="primary">Primario</label>
                <input
                  id="primary"
                  type="color"
                  bind:value={formData.color_primary}
                />
                <span class="color-value">{formData.color_primary}</span>
              </div>
              <div class="color-input">
                <label for="secondary">Secondario</label>
                <input
                  id="secondary"
                  type="color"
                  bind:value={formData.color_secondary}
                />
                <span class="color-value">{formData.color_secondary}</span>
              </div>
              <div class="color-input">
                <label for="accent">Accento</label>
                <input
                  id="accent"
                  type="color"
                  bind:value={formData.color_accent}
                />
                <span class="color-value">{formData.color_accent}</span>
              </div>
            </div>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn-primary btn-with-icon" disabled={saving}>
              {#if saving}
                <Icon name="loader" size={18} className="icon-spin" />
                <span>Salvataggio...</span>
              {:else}
                <Icon name="save" size={18} />
                <span>Salva Modifiche</span>
              {/if}
            </button>
          </div>
        </form>

        <div class="operating-settings-card">
          <div class="operating-settings-header">
            <h3>Orari di Funzionamento Ambulatorio</h3>
            <p>
              Configura giorni, fasce orarie, durata minima e durata standard visita per questo ambulatorio.
            </p>
          </div>

          {#if loadingOperatingSettings}
            <div class="loading-state">Caricamento orari ambulatorio...</div>
          {:else}
            {#if !canEditOperatingSettings}
              <p class="operating-settings-readonly">
                Solo amministratori e medici possono modificare giorni e orari di funzionamento.
              </p>
            {/if}

            <div class="operating-settings-grid">
              <div class="form-group">
                <label for="minVisitDurationMinutes">Durata minima visita (minuti)</label>
                <input
                  id="minVisitDurationMinutes"
                  type="number"
                  class="common-field"
                  min="10"
                  step="1"
                  bind:value={minVisitDurationMinutes}
                  disabled={!canEditOperatingSettings || savingOperatingSettings}
                />
              </div>

              <div class="form-group">
                <label for="standardVisitDurationMinutes">Durata standard visita (minuti)</label>
                <input
                  id="standardVisitDurationMinutes"
                  type="number"
                  class="common-field"
                  min="10"
                  step="1"
                  bind:value={standardVisitDurationMinutes}
                  disabled={!canEditOperatingSettings || savingOperatingSettings}
                />
                <small class="operating-settings-help">
                  La durata standard viene usata per nuovi appuntamenti e follow-up. Deve essere maggiore o uguale alla durata minima.
                </small>
              </div>
            </div>

            <div class="operating-window-list">
              {#if operatingWindowsForm.length === 0}
                <p class="operating-window-empty">Nessuna fascia oraria configurata.</p>
              {:else}
                {#each operatingWindowsForm as window (window.uiId)}
                  <div class="operating-window-row">
                    <div class="form-group">
                      <label for={`weekday-${window.uiId}`}>Giorno</label>
                      <select
                        id={`weekday-${window.uiId}`}
                        class="common-field"
                        bind:value={window.weekday}
                        disabled={!canEditOperatingSettings || savingOperatingSettings}
                      >
                        {#each weekdayOptions as option}
                          <option value={option.value}>{option.label}</option>
                        {/each}
                      </select>
                    </div>

                    <div class="form-group">
                      <label for={`start-${window.uiId}`}>Inizio</label>
                      <input
                        id={`start-${window.uiId}`}
                        type="time"
                        class="common-field"
                        bind:value={window.ora_inizio}
                        disabled={!canEditOperatingSettings || savingOperatingSettings}
                      />
                    </div>

                    <div class="form-group">
                      <label for={`end-${window.uiId}`}>Fine</label>
                      <input
                        id={`end-${window.uiId}`}
                        type="time"
                        class="common-field"
                        bind:value={window.ora_fine}
                        disabled={!canEditOperatingSettings || savingOperatingSettings}
                      />
                    </div>

                    <div class="form-group">
                      <label for={`max-patients-${window.uiId}`}>Max pazienti/giorno</label>
                      <input
                        id={`max-patients-${window.uiId}`}
                        type="number"
                        class="common-field"
                        min="1"
                        step="1"
                        bind:value={window.max_pazienti_giorno}
                        disabled={!canEditOperatingSettings || savingOperatingSettings}
                      />
                    </div>

                    <button
                      type="button"
                      class="btn-icon btn-operating-remove"
                      on:click={() => removeOperatingWindowRow(window.uiId)}
                      title="Rimuovi fascia oraria"
                      disabled={!canEditOperatingSettings || savingOperatingSettings}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                {/each}
              {/if}
            </div>

            <div class="operating-settings-actions">
              <button
                type="button"
                class="btn-secondary btn-with-icon"
                on:click={addOperatingWindowRow}
                disabled={!canEditOperatingSettings || savingOperatingSettings}
              >
                <Icon name="calendar-plus" size={18} />
                <span>Aggiungi Giorno/Fascia</span>
              </button>

              <button
                type="button"
                class="btn-primary btn-with-icon"
                on:click={handleSaveOperatingSettings}
                disabled={!canEditOperatingSettings || savingOperatingSettings}
              >
                <Icon name="save" size={18} />
                <span>{savingOperatingSettings ? 'Salvataggio...' : 'Salva Orari'}</span>
              </button>
            </div>
          {/if}
        </div>
      </Card>
    {:else if activeTab === 'utenti'}
      {#if isAdmin}
        <Card padding="lg">
          <div class="section-header">
            <h2 class="section-title">Gestione Utenti</h2>
            <button class="btn-primary btn-with-icon" on:click={handleNewUser}>
              <Icon name="user-plus" size={18} />
              <span>Nuovo Utente</span>
            </button>
          </div>

          {#if loadingUsers}
            <div class="loading-state">Caricamento utenti...</div>
          {:else if users.length === 0}
            <div class="empty-state">
              <p class="empty-text">Nessun utente trovato</p>
              <p class="empty-subtext">Crea il primo utente per iniziare</p>
            </div>
          {:else}
            <div class="users-table">
              <table>
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Username</th>
                    <th>Password</th>
                    <th>Ruolo</th>
                    <th>Creato il</th>
                    <th>Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {#each users as userItem (userItem.id)}
                    <tr>
                      <td>
                        <div class="user-name">{userItem.nome} {userItem.cognome}</div>
                      </td>
                      <td>{userItem.username}</td>
                      <td>
                        <span class="password-hidden">••••••••</span>
                      </td>
                      <td>
                        <span class="role-badge" style="background-color: {getRoleBadge(userItem.role).color}">
                          {getRoleBadge(userItem.role).label}
                        </span>
                      </td>
                      <td>
                        {new Date(userItem.created_at).toLocaleDateString('it-IT')}
                      </td>
                      <td>
                        <div class="actions">
                          <button
                            class="btn-icon"
                            on:click={() => handleEditUser(userItem)}
                            title="Modifica"
                          >
                            <Icon name="pencil" size={16} />
                          </button>
                          <button
                            class="btn-icon"
                            on:click={() => openDeleteModal(userItem)}
                            disabled={userItem.id === user?.id}
                            title={userItem.id === user?.id ? 'Non puoi eliminare il tuo account' : 'Elimina'}
                          >
                            <Icon name="trash" size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </Card>
      {:else}
        <Card padding="lg">
          <div class="access-denied">
            <div class="access-denied-icon" aria-hidden="true">
              <Icon name="lock" size={64} />
            </div>
            <h2>Accesso Negato</h2>
            <p>Solo gli amministratori possono accedere alla gestione utenti.</p>
          </div>
        </Card>
      {/if}
    {:else if activeTab === 'integrazioni'}
      <Card padding="lg">
        <h2 class="section-title">Integrazioni</h2>

        <div class="integrations-grid">
          <div class="integration-card disabled">
            <div class="integration-header">
              <div class="integration-icon" aria-hidden="true">
                <Icon name="building" size={24} />
              </div>
              <div class="integration-info">
                <h3>Sistema Tessera Sanitaria</h3>
                <p class="integration-description">Integrazione con il Sistema TS per la lettura e validazione delle tessere sanitarie</p>
              </div>
            </div>
            <div class="integration-status">
              <span class="status-badge status-inactive">Non configurato</span>
            </div>
          </div>

          <div class="integration-card disabled">
            <div class="integration-header">
              <div class="integration-icon" aria-hidden="true">
                <Icon name="clipboard-list" size={24} />
              </div>
              <div class="integration-info">
                <h3>Prescrizioni Elettroniche (SAC)</h3>
                <p class="integration-description">Sistema di Accoglienza Centralizzato per la gestione delle ricette elettroniche</p>
              </div>
            </div>
            <div class="integration-status">
              <span class="status-badge status-inactive">Non configurato</span>
            </div>
          </div>

          <div class="integration-card disabled">
            <div class="integration-header">
              <div class="integration-icon" aria-hidden="true">
                <Icon name="flask" size={24} />
              </div>
              <div class="integration-info">
                <h3>Laboratori</h3>
                <p class="integration-description">Integrazione con laboratori esterni per l'invio e ricezione di referti</p>
              </div>
            </div>
            <div class="integration-status">
              <span class="status-badge status-inactive">Non configurato</span>
            </div>
          </div>

          <div class="integration-card disabled">
            <div class="integration-header">
              <div class="integration-icon" aria-hidden="true">
                <Icon name="pill" size={24} />
              </div>
              <div class="integration-info">
                <h3>Farmacie</h3>
                <p class="integration-description">Collegamento con il network delle farmacie per la distribuzione farmaci</p>
              </div>
            </div>
            <div class="integration-status">
              <span class="status-badge status-inactive">Non configurato</span>
            </div>
          </div>
        </div>

        <div class="info-box">
          <div class="info-icon" aria-hidden="true">
            <Icon name="info" size={20} />
          </div>
          <div>
            <p><strong>Funzionalità in sviluppo</strong></p>
            <p>Queste integrazioni saranno disponibili nelle prossime versioni del software.</p>
          </div>
        </div>
      </Card>
    {:else if activeTab === 'backup'}
      <Card padding="lg">
        <h2 class="section-title">Backup e Ripristino</h2>
        <p class="text-secondary">Funzionalità in sviluppo...</p>
      </Card>
    {:else if activeTab === 'sistema'}
      <Card padding="lg">
        <h2 class="section-title">Informazioni Sistema</h2>

        <div class="system-info">
          <div class="info-section">
            <h3>Referti</h3>

            {#if loadingReportSettings}
              <div class="loading-state">Caricamento cartella referti...</div>
            {:else}
              <div class="report-settings">
                <Input
                  id="reportBaseDirectory"
                  type="text"
                  label="Cartella base referti"
                  bind:value={reportBaseDirectory}
                  placeholder="Percorso assoluto della cartella referti"
                />

                <p class="report-help">
                  I referti vengono salvati automaticamente in una sottocartella per ogni ambulatorio.
                  Per l'ambulatorio dislipidemie vengono create anche le sottocartelle
                  <strong> Repatha</strong>, <strong>Praluent</strong>, <strong>Leqvio</strong> e
                  <strong> Altro</strong>.
                </p>

                <p class="report-default-path">
                  Percorso predefinito: <span>{defaultReportBaseDirectory}</span>
                </p>

                <div class="report-actions">
                  <button type="button" class="btn-secondary btn-with-icon" on:click={handleChooseReportDirectory}>
                    <Icon name="folder-open" size={18} />
                    <span>Scegli Cartella</span>
                  </button>
                  <button type="button" class="btn-primary btn-with-icon" on:click={handleSaveReportDirectory}>
                    <Icon name="save" size={18} />
                    <span>Salva Percorso</span>
                  </button>
                  <button type="button" class="btn-secondary btn-with-icon" on:click={handleResetReportDirectory}>
                    <Icon name="rotate-ccw" size={18} />
                    <span>Ripristina Predefinito</span>
                  </button>
                </div>
              </div>
            {/if}
          </div>

          <div class="info-section">
            <h3>Applicazione</h3>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">Nome</span>
                <span class="info-value">GMD Medical Platform</span>
              </div>
              <div class="info-item">
                <span class="info-label">Versione</span>
                <span class="info-value">1.0.0</span>
              </div>
              <div class="info-item">
                <span class="info-label">Ambiente</span>
                <span class="info-value">Produzione</span>
              </div>
              <div class="info-item">
                <span class="info-label">Build</span>
                <span class="info-value">2025.01.15</span>
              </div>
            </div>
          </div>

          <div class="info-section">
            <h3>Tecnologie</h3>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">Framework</span>
                <span class="info-value">Tauri 2.x + SvelteKit</span>
              </div>
              <div class="info-item">
                <span class="info-label">Database</span>
                <span class="info-value">{apiMode ? 'PostgreSQL (Supabase)' : 'SQLite'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Runtime</span>
                <span class="info-value">Node.js + Rust</span>
              </div>
              <div class="info-item">
                <span class="info-label">Piattaforma</span>
                <span class="info-value">{navigator.platform}</span>
              </div>
            </div>
          </div>

          <div class="info-section">
            <h3>Database</h3>
            {#if loadingDatabaseSettings}
              <div class="loading-state">Caricamento cartella database...</div>
            {:else}
              {#if apiMode}
                <div class="info-grid">
                  <div class="info-item">
                    <span class="info-label">Tipo</span>
                    <span class="info-value">PostgreSQL remoto (Supabase)</span>
                  </div>
                  <div class="info-item">
                    <span class="info-label">Provider dati</span>
                    <span class="info-value">API (senza fallback SQLite)</span>
                  </div>
                  <div class="info-item full-width">
                    <span class="info-label">Endpoint runtime</span>
                    <span class="info-value">{runtimeDatabaseUrl}</span>
                  </div>
                  <div class="info-item">
                    <span class="info-label">Stato</span>
                    <span class="status-badge status-active">Connesso</span>
                  </div>
                </div>
              {:else}
                <div class="report-settings">
                  <Input
                    id="databaseDirectory"
                    type="text"
                    label="Cartella database"
                    bind:value={databaseDirectory}
                    placeholder="Percorso assoluto della cartella database"
                    disabled={!isAdmin || switchingDatabaseDirectory}
                  />

                  {#if !isAdmin}
                    <p class="report-help">
                      Solo gli amministratori possono modificare la cartella del database.
                    </p>
                  {/if}

                  <p class="report-default-path">
                    Percorso predefinito: <span>{defaultDatabaseDirectory}</span>
                  </p>

                  <div class="report-actions">
                    <button
                      type="button"
                      class="btn-secondary btn-with-icon"
                      on:click={handleChooseDatabaseDirectory}
                      disabled={!isAdmin || switchingDatabaseDirectory}
                    >
                      <Icon name="folder-open" size={18} />
                      <span>Scegli Cartella</span>
                    </button>
                    <button
                      type="button"
                      class="btn-primary btn-with-icon"
                      on:click={handleApplyDatabaseDirectory}
                      disabled={!isAdmin || switchingDatabaseDirectory}
                    >
                      <Icon name="save" size={18} />
                      <span>{switchingDatabaseDirectory ? 'Applicazione in corso...' : 'Applica e Migra'}</span>
                    </button>
                    <button
                      type="button"
                      class="btn-secondary btn-with-icon"
                      on:click={handleResetDatabaseDirectory}
                      disabled={!isAdmin || switchingDatabaseDirectory}
                    >
                      <Icon name="rotate-ccw" size={18} />
                      <span>Ripristina Predefinito</span>
                    </button>
                  </div>
                </div>

                <div class="info-grid">
                  <div class="info-item">
                    <span class="info-label">Tipo</span>
                    <span class="info-value">SQLite Locale</span>
                  </div>
                  <div class="info-item">
                    <span class="info-label">URL Runtime</span>
                    <span class="info-value">{runtimeDatabaseUrl}</span>
                  </div>
                  <div class="info-item">
                    <span class="info-label">Percorso attivo</span>
                    <span class="info-value">{runtimeDatabasePath}</span>
                  </div>
                  <div class="info-item">
                    <span class="info-label">Cartella attiva</span>
                    <span class="info-value">{databaseDirectory}</span>
                  </div>
                  <div class="info-item">
                    <span class="info-label">Stato</span>
                    <span class="status-badge status-active">Connesso</span>
                  </div>
                </div>
              {/if}
            {/if}
          </div>

          <div class="info-section">
            <h3>Supporto</h3>
            <div class="info-grid">
              <div class="info-item full-width">
                <span class="info-label">Documentazione</span>
                <button type="button" class="info-link info-link-button" on:click={handleOpenDocumentationPlaceholder}>
                  Apri documentazione
                </button>
              </div>
              <div class="info-item full-width">
                <span class="info-label">Segnala un problema</span>
                <button type="button" class="info-link info-link-button" on:click={handleOpenIssueTrackerPlaceholder}>
                  Apri issue tracker
                </button>
              </div>
              <div class="info-item full-width">
                <span class="info-label">Licenza</span>
                <span class="info-value">Proprietaria - Uso Interno</span>
              </div>
            </div>
          </div>
        </div>
      </Card>
    {/if}
  </div>
</div>

<UserFormModal
  user={editingUser}
  isOpen={showUserModal}
  on:submit={handleUserSubmit}
  on:close={() => showUserModal = false}
/>

<!-- Modal Conferma Eliminazione -->
<Modal bind:open={showDeleteModal} title="Conferma Eliminazione" size="sm">
  <p style="margin-bottom: var(--space-6);">
    Sei sicuro di voler eliminare l'utente <strong>{userToDelete?.nome} {userToDelete?.cognome}</strong>?<br />
    Questa azione non può essere annullata.
  </p>
  <div style="display: flex; gap: var(--space-3); justify-content: flex-end;">
    <Button variant="secondary" on:click={() => (showDeleteModal = false)}>
      Annulla
    </Button>
    <Button variant="primary" on:click={handleDeleteUser}>
      Conferma Eliminazione
    </Button>
  </div>
</Modal>

<style>
  .impostazioni {
    padding: var(--space-8);
    max-width: 1240px;
    margin: 0 auto;
  }

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-bottom: var(--space-6);
    padding: var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    background: linear-gradient(180deg, var(--color-bg-secondary), var(--color-bg));
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    min-height: 44px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-lg);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: all var(--transition-fast);
    white-space: nowrap;
  }

  .tab-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  .tab-icon .icon-svg {
    width: 18px;
    height: 18px;
  }

  .tab .icon-svg,
  .btn-primary .icon-svg,
  .btn-secondary .icon-svg,
  .btn-icon .icon-svg,
  .integration-icon .icon-svg,
  .info-icon .icon-svg,
  .access-denied-icon .icon-svg {
    color: currentColor;
  }

  .tab .icon-svg:hover,
  .btn-primary .icon-svg:hover,
  .btn-secondary .icon-svg:hover,
  .btn-icon .icon-svg:hover,
  .integration-icon .icon-svg:hover,
  .info-icon .icon-svg:hover,
  .access-denied-icon .icon-svg:hover {
    color: currentColor;
    transform: none;
  }

  .tab-label {
    line-height: 1.1;
  }

  .tab:hover:not(:disabled) {
    background-color: var(--color-bg-secondary);
    color: var(--color-text);
  }

  .tab.active {
    background-color: var(--color-bg);
    color: var(--color-primary);
    border-color: var(--color-border);
    box-shadow: var(--shadow-sm);
  }

  .tab-content {
    min-height: 400px;
  }

  .section-title {
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--color-text);
    margin: 0;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-6);
  }

  .section-header .section-title {
    margin: 0;
  }

  .settings-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
  }

  .form-group label {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text);
  }

  .common-field {
    width: 100%;
    height: 34px;
    padding: var(--space-1) var(--space-4);
    font-size: var(--text-base);
    font-family: var(--font-sans);
    color: var(--color-text);
    background-color: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    transition: all var(--transition-fast);
    box-sizing: border-box;
    -webkit-box-sizing: border-box;
    -moz-box-sizing: border-box;
  }

  select.common-field {
    appearance: none;
    cursor: pointer;
  }

  .common-field:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px rgba(30, 58, 138, 0.1);
  }

  .common-field:disabled {
    background-color: var(--color-bg-secondary);
    cursor: not-allowed;
    opacity: 0.6;
  }

  .form-group-title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text);
  }

  .logo-upload {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-4);
  }

  .logo-preview {
    width: 100px;
    height: 100px;
    object-fit: contain;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-2);
  }

  .logo-placeholder {
    width: 100px;
    height: 100px;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--color-bg-secondary);
    border: 2px dashed var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .color-row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-4);
  }

  .color-input {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .color-input label {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .color-input input[type="color"] {
    width: 80px;
    height: 40px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
  }

  .color-value {
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    color: var(--color-text-secondary);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border);
  }

  .operating-settings-card {
    margin-top: var(--space-8);
    padding-top: var(--space-6);
    border-top: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .operating-settings-header h3 {
    margin: 0;
    font-size: var(--text-lg);
    color: var(--color-text);
  }

  .operating-settings-header p {
    margin: var(--space-2) 0 0 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .operating-settings-readonly {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .operating-settings-grid {
    display: grid;
    grid-template-columns: minmax(220px, 320px);
    gap: var(--space-4);
  }

  .operating-settings-help {
    margin-top: 4px;
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    line-height: 1.4;
  }

  .operating-window-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .operating-window-empty {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .operating-window-row {
    display: grid;
    grid-template-columns: 1.2fr 1fr 1fr 1fr auto;
    gap: var(--space-3);
    align-items: end;
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-secondary);
  }

  .btn-operating-remove {
    align-self: center;
  }

  .operating-settings-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .report-settings {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .report-help,
  .report-default-path {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: 1.5;
  }

  .report-default-path span {
    font-family: var(--font-mono);
    color: var(--color-text);
    word-break: break-all;
  }

  .report-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .btn-with-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
  }

  .btn-primary,
  .btn-secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-6);
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .btn-primary {
    background-color: var(--color-primary);
    color: white;
    border-color: var(--color-primary);
  }

  .btn-primary:hover:not(:disabled) {
    background-color: var(--color-secondary);
    border-color: var(--color-secondary);
    transform: translateY(-1px);
    box-shadow: var(--shadow-sm);
  }

  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }

  .btn-secondary {
    background-color: var(--color-bg);
    color: var(--color-text);
    border: 1px solid var(--color-border);
  }

  .btn-secondary:hover:not(:disabled) {
    background-color: var(--color-bg-tertiary);
    border-color: var(--color-text-tertiary);
    transform: translateY(-1px);
    box-shadow: var(--shadow-sm);
  }

  .btn-secondary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }

  .btn-primary .icon-svg,
  .btn-secondary .icon-svg {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }

  .icon-spin {
    animation: settings-spin 0.8s linear infinite;
  }

  .text-secondary {
    color: var(--color-text-secondary);
    font-size: var(--text-base);
  }

  .tab:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .tab:disabled:hover {
    background-color: transparent;
    color: var(--color-text-secondary);
  }

  /* Gestione Utenti */
  .loading-state,
  .empty-state {
    text-align: center;
    padding: var(--space-12) var(--space-4);
    color: var(--color-text-secondary);
  }

  .empty-text {
    font-size: var(--text-lg);
    font-weight: 500;
    color: var(--color-text);
    margin: 0 0 var(--space-2) 0;
  }

  .empty-subtext {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .users-table {
    overflow-x: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background-color: var(--color-bg);
  }

  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
  }

  thead {
    background-color: var(--color-bg-secondary);
  }

  th {
    text-align: left;
    padding: var(--space-3) var(--space-4);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text);
    border-bottom: 2px solid var(--color-border);
  }

  th:last-child {
    text-align: center;
  }

  td {
    padding: var(--space-4);
    border-bottom: 1px solid var(--color-border);
    font-size: var(--text-sm);
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  td:last-child {
    text-align: center;
  }

  tbody tr:hover {
    background-color: var(--color-bg-secondary);
  }

  .user-name {
    font-weight: 500;
    color: var(--color-text);
  }

  .password-hidden {
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
    letter-spacing: 2px;
  }

  .role-badge {
    display: inline-block;
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: 600;
    color: white;
  }

  .actions {
    display: flex;
    gap: var(--space-2);
    justify-content: center;
  }

  .btn-icon {
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    transition: all var(--transition-fast);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    color: var(--color-text-secondary);
    opacity: 1;
  }

  .btn-icon:hover:not(:disabled) {
    background-color: var(--color-bg-tertiary);
    border-color: var(--color-border);
    color: var(--color-primary);
    transform: translateY(-1px);
  }

  .btn-icon:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .btn-icon .icon-svg {
    width: 16px;
    height: 16px;
  }

  .access-denied {
    text-align: center;
    padding: var(--space-12) var(--space-4);
  }

  .access-denied-icon {
    width: 96px;
    height: 96px;
    margin: 0 auto var(--space-4);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-primary);
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
  }

  .access-denied-icon .icon-svg {
    width: 56px;
    height: 56px;
    stroke-width: 1.8;
  }

  .access-denied h2 {
    font-size: var(--text-2xl);
    font-weight: 600;
    color: var(--color-text);
    margin-bottom: var(--space-4);
  }

  .access-denied p {
    color: var(--color-text-secondary);
    margin: 0;
  }

  /* Integrazioni */
  .integrations-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: var(--space-4);
    margin-bottom: var(--space-6);
  }

  .integration-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
    background: linear-gradient(180deg, var(--color-bg), var(--color-bg-secondary));
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  }

  .integration-card:hover {
    border-color: var(--color-text-tertiary);
    box-shadow: var(--shadow-sm);
  }

  .integration-card.disabled {
    opacity: 0.85;
  }

  .integration-header {
    display: flex;
    gap: var(--space-4);
    margin-bottom: var(--space-3);
  }

  .integration-icon {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-primary);
    background-color: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    flex-shrink: 0;
  }

  .integration-icon .icon-svg {
    width: 22px;
    height: 22px;
  }

  .integration-info h3 {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--color-text);
    margin: 0 0 var(--space-2) 0;
  }

  .integration-description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .integration-status {
    display: flex;
    justify-content: flex-end;
  }

  .status-badge {
    display: inline-block;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .status-badge.status-active {
    background-color: var(--color-success);
    color: white;
  }

  .status-badge.status-inactive {
    background-color: var(--color-bg-tertiary);
    color: var(--color-text-secondary);
  }

  .info-box {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4);
    background-color: var(--color-bg-secondary);
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border);
    border-left: 4px solid var(--color-primary);
  }

  .info-icon {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-primary);
    background-color: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }

  .info-icon .icon-svg {
    width: 16px;
    height: 16px;
  }

  .info-box p {
    margin: 0 0 var(--space-1) 0;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .info-box p:last-child {
    margin: 0;
    color: var(--color-text-secondary);
  }

  /* Sistema */
  .system-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .info-section {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
    background: linear-gradient(180deg, var(--color-bg), var(--color-bg-secondary));
  }

  .info-section h3 {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--color-text);
    margin: 0 0 var(--space-4) 0;
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--color-border);
  }

  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
  }

  .info-item {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .info-item.full-width {
    grid-column: 1 / -1;
  }

  .info-label {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .info-value {
    font-size: var(--text-base);
    color: var(--color-text);
    font-family: var(--font-mono);
  }

  .info-link {
    font-size: var(--text-base);
    color: var(--color-primary);
    text-decoration: none;
    transition: color var(--transition-fast);
  }

  .info-link:hover {
    color: var(--color-secondary);
    text-decoration: underline;
  }

  .info-link-button {
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    font: inherit;
  }

  @keyframes settings-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 1024px) {
    .impostazioni {
      padding: var(--space-6);
    }

    .info-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 768px) {
    .impostazioni {
      padding: var(--space-6) var(--space-4);
    }

    .tabs {
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: thin;
    }

    .tab {
      flex: 0 0 auto;
    }

    .form-row,
    .color-row {
      grid-template-columns: 1fr;
    }

    .section-header {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-3);
    }

    .report-actions {
      flex-direction: column;
    }

    .report-actions .btn-primary,
    .report-actions .btn-secondary {
      width: 100%;
      justify-content: flex-start;
    }

    .operating-window-row {
      grid-template-columns: 1fr;
    }

    .operating-settings-actions {
      flex-direction: column;
    }

    .operating-settings-actions .btn-primary,
    .operating-settings-actions .btn-secondary {
      width: 100%;
      justify-content: flex-start;
    }

    th,
    td {
      padding: var(--space-3);
    }
  }
</style>
