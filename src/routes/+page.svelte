<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth';
  import { authenticateUser } from '$lib/db/auth';
  import { getScopedStorageKey } from '$lib/db/config';
  import Button from '$lib/components/Button.svelte';
  import Input from '$lib/components/Input.svelte';
  import Icon from '$lib/components/Icon.svelte';

  let username = '';
  let password = '';
  let error = '';
  let loading = false;
  let rememberMe = false;
  let showPassword = false;
  const REMEMBER_USERNAME_KEY = getScopedStorageKey('gmd_saved_username');

  function getErrorMessage(err: unknown): string {
    if (err instanceof Error && err.message) {
      return err.message;
    }

    if (typeof err === 'string' && err.trim()) {
      return err;
    }

    if (err && typeof err === 'object') {
      const maybeMessage = 'message' in err ? (err as { message?: unknown }).message : undefined;
      if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
        return maybeMessage;
      }

      try {
        const serialized = JSON.stringify(err);
        if (serialized && serialized !== '{}') {
          return serialized;
        }
      } catch {
        // ignore JSON serialization failures
      }
    }

    return 'Errore sconosciuto';
  }

  onMount(() => {
    // Carica credenziali salvate se presenti
    if (typeof window !== 'undefined') {
      const savedUsername = localStorage.getItem(REMEMBER_USERNAME_KEY);
      if (savedUsername) {
        username = savedUsername;
        rememberMe = true;
      }
    }

    // Se già autenticato, vai alla selezione ambulatorio
    const unsubscribe = authStore.subscribe((state) => {
      if (state.isAuthenticated) {
        goto('/ambulatori');
      }
    });

    return () => {
      unsubscribe();
    };
  });

  async function handleLogin() {
    error = '';
    loading = true;

    try {
      console.log('Tentativo login con username:', username);

      if (!username || !password) {
        error = 'Inserisci username e password';
        loading = false;
        return;
      }

      console.log('Chiamata authenticateUser...');
      const user = await authenticateUser(username, password);
      console.log('Risultato authenticateUser:', user);

      if (user) {
        console.log('Login riuscito!');

        // Salva credenziali se "Ricordami" è attivo
        if (typeof window !== 'undefined') {
          if (rememberMe) {
            localStorage.setItem(REMEMBER_USERNAME_KEY, username);
          } else {
            localStorage.removeItem(REMEMBER_USERNAME_KEY);
          }
        }

        authStore.login(user);
        goto('/ambulatori');
      } else {
        console.log('Credenziali non valide');
        error = 'Credenziali non valide';
      }
    } catch (err) {
      console.error('Errore login completo:', err);
      console.error('Stack trace:', err instanceof Error ? err.stack : undefined);
      error = `Errore: ${getErrorMessage(err)}`;
    } finally {
      loading = false;
    }
  }

  function handleKeyPress(e: Event) {
    const keyEvent = e as KeyboardEvent;
    if (keyEvent.key === 'Enter') {
      handleLogin();
    }
  }
</script>

<div class="login-page">
  <div class="login-container">
    <div class="login-card">
      <div class="logo-container">
        <img src="/logo_aziendale.png" alt="GMD Medical" class="logo" />
      </div>

      <h1 class="title">Benvenuto</h1>
      <p class="subtitle">Accedi alla piattaforma GMD Medical</p>

      <form on:submit|preventDefault={handleLogin} class="login-form">
        <Input
          id="username"
          type="text"
          label="Username"
          bind:value={username}
          placeholder="Inserisci username"
          required
          on:keypress={handleKeyPress}
        />

        <div class="password-field">
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            label="Password"
            bind:value={password}
            placeholder="Inserisci password"
            required
            on:keypress={handleKeyPress}
          />
          <button
            type="button"
            class="password-toggle"
            on:click={() => (showPassword = !showPassword)}
            aria-label={showPassword ? 'Nascondi password' : 'Mostra password'}
          >
            {#if showPassword}
              <Icon name="eye-off" size={20} />
            {:else}
              <Icon name="eye" size={20} />
            {/if}
          </button>
        </div>

        <div class="remember-me">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={rememberMe} />
            <span>Ricordami</span>
          </label>
        </div>

        {#if error}
          <div class="error-banner">
            {error}
          </div>
        {/if}

        <Button type="submit" variant="primary" size="lg" fullWidth disabled={loading}>
          {loading ? 'Accesso in corso...' : 'Accedi'}
        </Button>
      </form>

      <div class="login-footer">
        <p class="demo-credentials">
          <strong>Demo:</strong> username: <code>admin</code> | password: <code>admin123</code>
        </p>
      </div>
    </div>
  </div>
</div>

<style>
  .login-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, var(--gmd-navy) 0%, var(--gmd-blue) 50%, var(--gmd-cyan) 100%);
    padding: var(--space-6);
  }

  .login-container {
    width: 100%;
    max-width: 450px;
  }

  .login-card {
    background: var(--color-bg);
    border-radius: var(--radius-2xl);
    box-shadow: var(--shadow-xl);
    padding: var(--space-10);
    animation: slideUp 0.4s ease-out;
  }

  .logo-container {
    text-align: center;
    margin-bottom: var(--space-8);
  }

  .logo {
    height: 80px;
    width: auto;
  }

  .title {
    text-align: center;
    font-size: var(--text-3xl);
    color: var(--color-text);
    margin-bottom: var(--space-2);
  }

  .subtitle {
    text-align: center;
    color: var(--color-text-secondary);
    margin-bottom: var(--space-8);
  }

  .login-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .password-field {
    position: relative;
  }

  .password-toggle {
    position: absolute;
    right: var(--space-3);
    top: 50%;
    transform: translateY(-10%);
    background: none;
    border: none;
    cursor: pointer;
    padding: var(--space-2);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-secondary);
    transition: color var(--transition-fast);
  }

  .password-toggle:hover {
    color: var(--color-primary);
  }

  .password-toggle svg {
    width: 20px;
    height: 20px;
  }

  .remember-me {
    margin-top: calc(var(--space-2) * -1);
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .checkbox-label input[type='checkbox'] {
    width: 18px;
    height: 18px;
    cursor: pointer;
    accent-color: var(--color-primary);
  }

  .checkbox-label:hover span {
    color: var(--color-primary);
  }

  .error-banner {
    padding: var(--space-4);
    background-color: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: var(--radius-lg);
    color: var(--color-error);
    font-size: var(--text-sm);
    text-align: center;
  }

  .login-footer {
    margin-top: var(--space-6);
    padding-top: var(--space-6);
    border-top: 1px solid var(--color-border);
  }

  .demo-credentials {
    text-align: center;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .demo-credentials code {
    background-color: var(--color-bg-secondary);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(30px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
