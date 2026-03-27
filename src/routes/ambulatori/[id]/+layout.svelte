<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { authStore } from '$lib/stores/auth';
  import { ambulatorioStore } from '$lib/stores/ambulatorio';
  import { getAmbulatorioById } from '$lib/db/ambulatori';
  import { initDatabase } from '$lib/db/schema';
  import AppLayout from '$lib/components/AppLayout.svelte';
  import ToastContainer from '$lib/components/ToastContainer.svelte';

  let ambulatorioId: number;
  let loading = true;

  $: ambulatorioId = parseInt($page.params.id || '0');

  async function waitForDatabase(maxAttempts = 20): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        await initDatabase();
        return true;
      } catch (error) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    return false;
  }

  onMount(() => {
    // Verifica autenticazione
    const unsubscribe = authStore.subscribe((state) => {
      if (!state.isAuthenticated) {
        goto('/');
      }
    });

    // Carica ambulatorio (aspetta che il database sia pronto)
    (async () => {
      try {
        // Aspetta che il database sia inizializzato
        const dbReady = await waitForDatabase();
        if (!dbReady) {
          console.error('Database non pronto dopo 2 secondi');
          goto('/ambulatori');
          return;
        }

        const ambulatorio = await getAmbulatorioById(ambulatorioId);
        if (ambulatorio) {
          ambulatorioStore.select(ambulatorio);
        } else {
          goto('/ambulatori');
        }
      } catch (error) {
        console.error('Errore caricamento ambulatorio:', error);
        goto('/ambulatori');
      } finally {
        loading = false;
      }
    })();

    return () => {
      unsubscribe();
    };
  });
</script>

{#if loading}
  <div class="loading-screen">
    <div class="spinner"></div>
    <p>Caricamento ambulatorio...</p>
  </div>
{:else}
  <AppLayout {ambulatorioId}>
    <slot />
    <ToastContainer />
  </AppLayout>
{/if}

<style>
  .loading-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background-color: var(--color-bg-secondary);
    gap: var(--space-4);
  }

  .spinner {
    width: 48px;
    height: 48px;
    border: 4px solid var(--color-border);
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .loading-screen p {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
</style>
