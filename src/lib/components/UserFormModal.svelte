<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { User } from '$lib/db/types';

  export let user: User | null = null;
  export let isOpen = false;

  const dispatch = createEventDispatcher();
  const MIN_PASSWORD_LENGTH = 8;

  let formData = {
    username: '',
    password: '',
    confirmPassword: '',
    oldPassword: '',
    role: 'medico' as 'admin' | 'medico' | 'infermiere',
    nome: '',
    cognome: ''
  };

  $: if (user && isOpen) {
    formData.username = user.username;
    formData.password = '';
    formData.confirmPassword = '';
    formData.oldPassword = '';
    formData.role = user.role;
    formData.nome = user.nome;
    formData.cognome = user.cognome;
  } else if (!user && isOpen) {
    formData = {
      username: '',
      password: '',
      confirmPassword: '',
      oldPassword: '',
      role: 'medico',
      nome: '',
      cognome: ''
    };
  }

  function handleSubmit() {
    // Validazione per nuovo utente
    if (!user && formData.password !== formData.confirmPassword) {
      alert('Le password non coincidono');
      return;
    }

    if (!user && !formData.password) {
      alert('La password è obbligatoria per nuovi utenti');
      return;
    }

    if (!user && formData.password.length < MIN_PASSWORD_LENGTH) {
      alert(`La password deve contenere almeno ${MIN_PASSWORD_LENGTH} caratteri`);
      return;
    }

    // Validazione per modifica password utente esistente
    if (user && formData.password) {
      if (!formData.oldPassword) {
        alert('Inserisci la vecchia password per modificarla');
        return;
      }
      if (formData.password.length < MIN_PASSWORD_LENGTH) {
        alert(`La nuova password deve contenere almeno ${MIN_PASSWORD_LENGTH} caratteri`);
        return;
      }
      if (formData.password !== formData.confirmPassword) {
        alert('Le nuove password non coincidono');
        return;
      }
    }

    dispatch('submit', {
      id: user?.id,
      username: formData.username,
      password: formData.password || undefined,
      oldPassword: formData.oldPassword || undefined,
      role: formData.role,
      nome: formData.nome,
      cognome: formData.cognome
    });
  }

  function handleClose() {
    dispatch('close');
  }

  function handleOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      handleClose();
    }
  }

  function handleOverlayKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleClose();
    }
  }
</script>

{#if isOpen}
  <div
    class="modal-overlay"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:click={handleOverlayClick}
    on:keydown={handleOverlayKeydown}
  >
    <div class="modal">
      <div class="modal-header">
        <h2>{user ? 'Modifica Utente' : 'Nuovo Utente'}</h2>
        <button class="close-btn" on:click={handleClose}>×</button>
      </div>

      <form on:submit|preventDefault={handleSubmit} class="modal-body">
        <div class="form-row">
          <div class="form-group">
            <label for="nome">Nome</label>
            <input
              id="nome"
              type="text"
              bind:value={formData.nome}
              required
              placeholder="Nome"
            />
          </div>

          <div class="form-group">
            <label for="cognome">Cognome</label>
            <input
              id="cognome"
              type="text"
              bind:value={formData.cognome}
              required
              placeholder="Cognome"
            />
          </div>
        </div>

        <div class="form-group">
          <label for="username">Username</label>
          <input
            id="username"
            type="text"
            bind:value={formData.username}
            required
            placeholder="Username"
          />
        </div>

        <div class="form-group">
          <label for="role">Ruolo</label>
          <select id="role" bind:value={formData.role} required>
            <option value="admin">Amministratore</option>
            <option value="medico">Medico</option>
            <option value="infermiere">Infermiere</option>
          </select>
        </div>

        {#if !user}
          <div class="form-group">
            <label for="password">Password</label>
            <input
              id="password"
              type="password"
              bind:value={formData.password}
              required
              placeholder="Password"
              minlength={MIN_PASSWORD_LENGTH}
            />
          </div>

          <div class="form-group">
            <label for="confirmPassword">Conferma Password</label>
            <input
              id="confirmPassword"
              type="password"
              bind:value={formData.confirmPassword}
              required
              placeholder="Conferma Password"
              minlength={MIN_PASSWORD_LENGTH}
            />
          </div>
        {:else}
          <div class="password-section">
            <h3>Modifica Password (opzionale)</h3>
            <div class="form-group">
              <label for="oldPassword">Vecchia Password</label>
              <input
                id="oldPassword"
                type="password"
                bind:value={formData.oldPassword}
                placeholder="Inserisci la vecchia password"
              />
            </div>

            <div class="form-group">
              <label for="password">Nuova Password</label>
              <input
                id="password"
                type="password"
                bind:value={formData.password}
                placeholder="Inserisci la nuova password"
                minlength={MIN_PASSWORD_LENGTH}
              />
            </div>

            <div class="form-group">
              <label for="confirmPassword">Conferma Nuova Password</label>
              <input
                id="confirmPassword"
                type="password"
                bind:value={formData.confirmPassword}
                placeholder="Conferma la nuova password"
                minlength={MIN_PASSWORD_LENGTH}
              />
            </div>
          </div>
        {/if}

        <div class="modal-footer">
          <button type="button" class="btn-secondary" on:click={handleClose}>
            Annulla
          </button>
          <button type="submit" class="btn-primary">
            {user ? 'Salva Modifiche' : 'Crea Utente'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    padding: var(--space-4);
  }

  .modal {
    background: white;
    border-radius: var(--radius-lg);
    max-width: 600px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: var(--shadow-xl);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-6);
    border-bottom: 1px solid var(--color-border);
  }

  .modal-header h2 {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--color-text);
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 28px;
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    transition: all var(--transition-fast);
  }

  .close-btn:hover {
    background-color: var(--color-bg-secondary);
    color: var(--color-text);
  }

  .modal-body {
    padding: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
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

  .form-group input,
  .form-group select {
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-family: var(--font-sans);
    font-size: var(--text-base);
    color: var(--color-text);
    transition: border-color var(--transition-fast);
  }

  .form-group input:focus,
  .form-group select:focus {
    outline: none;
    border-color: var(--color-primary);
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border);
  }

  .btn-primary,
  .btn-secondary {
    padding: var(--space-3) var(--space-6);
    border-radius: var(--radius-md);
    font-family: var(--font-sans);
    font-size: var(--text-base);
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .btn-primary {
    background-color: var(--color-bg);
    color: var(--color-text);
    border: 1px solid var(--color-border);
  }

  .btn-primary:hover {
    background-color: var(--color-bg-secondary);
    border-color: var(--color-text-secondary);
  }

  .btn-secondary {
    background-color: var(--color-bg-secondary);
    color: var(--color-text-secondary);
    border: 1px solid var(--color-border);
  }

  .btn-secondary:hover {
    background-color: var(--color-bg-tertiary);
    color: var(--color-text);
  }

  .password-section {
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-4);
    margin-top: var(--space-2);
  }

  .password-section h3 {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--color-text);
    margin: 0 0 var(--space-4) 0;
  }
</style>
