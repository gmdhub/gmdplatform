<script lang="ts">
  import { onMount } from 'svelte';
  import { authStore } from '$lib/stores/auth';
  import { ambulatorioStore } from '$lib/stores/ambulatorio';
  import { initDatabase } from '$lib/db/schema';
  import { ensureStorageIsolationForEnvironment } from '$lib/db/config';
  import '../app.css';

  async function notifyNativeAppReady(): Promise<void> {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      return;
    }

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_app_ready');
    } catch (error) {
      console.warn('Impossibile notificare splash nativa:', error);
    }
  }

  async function bootstrapApp(): Promise<void> {
    ensureStorageIsolationForEnvironment();

    try {
      await initDatabase();
      console.log('Database inizializzato con successo');
    } catch (error) {
      console.error('Errore inizializzazione database:', error);
    }

    try {
      authStore.restore();
      ambulatorioStore.restore();
    } catch (error) {
      console.error('Errore ripristino stato applicazione:', error);
    }

    if (typeof window !== 'undefined') {
      (window as typeof window & { __gmdAppReady?: boolean }).__gmdAppReady = true;
      window.dispatchEvent(new Event('gmd:app-ready'));
    }

    await notifyNativeAppReady();
  }

  onMount(() => {
    void bootstrapApp();
  });
</script>

<div class="app">
  <slot />
</div>

<style>
  .app {
    height: 100vh;
    display: flex;
    flex-direction: column;
    padding-top: 0px; /* Spazio per la titlebar macOS */
    overflow-y: auto; /* Lo scroll avviene qui, non sul body */
    overflow-x: hidden;
    box-sizing: border-box;
  }
</style>
