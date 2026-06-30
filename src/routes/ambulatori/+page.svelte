<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth';
  import { ambulatorioStore } from '$lib/stores/ambulatorio';
  import { getAllAmbulatori } from '$lib/db/ambulatori';
  import type { Ambulatorio } from '$lib/db/types';
  import Card from '$lib/components/Card.svelte';
  import Button from '$lib/components/Button.svelte';

  let ambulatori: Ambulatorio[] = [];
  let loading = true;
  let currentUser: any = null;

  function isSelectableAmbulatorio(ambulatorio: Ambulatorio) {
    return ambulatorio.nome !== 'Ortopedia';
  }

  onMount(() => {
    // Verifica autenticazione
    const unsubscribe = authStore.subscribe((state) => {
      if (!state.isAuthenticated) {
        goto('/');
      } else {
        currentUser = state.user;
      }
    });

    // Carica ambulatori
    (async () => {
      try {
        const allAmbulatori = await getAllAmbulatori();
        ambulatori = allAmbulatori.filter(isSelectableAmbulatorio);
      } catch (error) {
        console.error('Errore caricamento ambulatori:', error);
      } finally {
        loading = false;
      }
    })();

    return () => {
      unsubscribe();
    };
  });

  function selectAmbulatorio(ambulatorio: Ambulatorio) {
    ambulatorioStore.select(ambulatorio);
    goto(`/ambulatori/${ambulatorio.id}`);
  }

  function handleLogout() {
    authStore.logout();
    ambulatorioStore.clear();
    goto('/');
  }
</script>

<div class="ambulatori-page">
  <div class="header">
    <div class="header-content">
      <div class="logo-container">
        <img src="/logo_aziendale.png" alt="GMD Medical" class="logo" />
      </div>
      <div class="user-info">
        {#if currentUser}
          <span class="user-name">{currentUser.nome} {currentUser.cognome}</span>
          <span class="user-role">({currentUser.role})</span>
        {/if}
        <Button variant="outline" size="sm" on:click={handleLogout}>
          Esci
        </Button>
      </div>
    </div>
  </div>

  <div class="content">
    <div class="container">
      <h1 class="page-title">Seleziona Ambulatorio</h1>
      <p class="page-subtitle">Scegli l'ambulatorio su cui lavorare</p>

      {#if loading}
        <div class="loading">Caricamento ambulatori...</div>
      {:else if ambulatori.length === 0}
        <div class="empty-state">
          <p>Nessun ambulatorio disponibile</p>
        </div>
      {:else}
        <div class="ambulatori-grid">
          {#each ambulatori as ambulatorio}
            <div
              class="ambulatorio-card-shell"
              style="--ambulatorio-primary: {ambulatorio.color_primary}; --ambulatorio-secondary: {ambulatorio.color_secondary}; --ambulatorio-accent: {ambulatorio.color_accent};"
            >
              <Card hover clickable on:click={() => selectAmbulatorio(ambulatorio)}>
                <div class="ambulatorio-card">
                  <div class="ambulatorio-icon">
                    {#if ambulatorio.logo_path}
                      <img src={ambulatorio.logo_path} alt={ambulatorio.nome} class="ambulatorio-logo" />
                    {:else}
                      <div
                        class="ambulatorio-icon-fallback"
                        style="background: linear-gradient(135deg, {ambulatorio.color_primary} 0%, {ambulatorio.color_secondary} 100%);"
                      >
                        <span class="icon-letter">{ambulatorio.nome[0]}</span>
                      </div>
                    {/if}
                  </div>
                  <h3 class="ambulatorio-name">{ambulatorio.nome}</h3>
                </div>
              </Card>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .ambulatori-page {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background-color: var(--color-bg-secondary);
  }

  .header {
    background-color: var(--color-bg);
    border-bottom: 1px solid var(--color-border);
    padding: var(--space-4) 0;
  }

  .header-content {
    max-width: 1280px;
    margin: 0 auto;
    padding: 0 var(--space-6);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .logo-container .logo {
    height: 40px;
    width: auto;
  }

  .user-info {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .user-name {
    font-weight: 600;
    color: var(--color-text);
  }

  .user-role {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .content {
    flex: 1;
    padding: var(--space-12) 0;
  }

  .page-title {
    font-size: var(--text-4xl);
    text-align: center;
    margin-bottom: var(--space-2);
    color: var(--color-text);
  }

  .page-subtitle {
    text-align: center;
    color: var(--color-text-secondary);
    font-size: var(--text-lg);
    margin-bottom: var(--space-12);
  }

  .loading,
  .empty-state {
    text-align: center;
    color: var(--color-text-secondary);
    padding: var(--space-12);
  }

  .ambulatori-grid {
    display: grid;
    width: min(100%, 760px);
    margin: 0 auto;
    grid-template-columns: repeat(auto-fit, minmax(280px, 340px));
    justify-content: center;
    align-items: stretch;
    gap: var(--space-6);
    animation: fadeIn 0.4s ease-out;
  }

  .ambulatori-grid :global(.card) {
    border-radius: 32px;
  }

  .ambulatorio-card-shell {
    height: 100%;
  }

  .ambulatorio-card-shell :global(.card) {
    height: 280px;
    border-color: color-mix(in srgb, var(--ambulatorio-primary) 12%, var(--color-border));
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .ambulatorio-card-shell:hover :global(.card.card-clickable),
  .ambulatorio-card-shell:focus-within :global(.card.card-clickable) {
    border-color: var(--ambulatorio-primary);
    box-shadow:
      0 18px 40px color-mix(in srgb, var(--ambulatorio-primary) 18%, transparent),
      0 0 0 3px color-mix(in srgb, var(--ambulatorio-primary) 16%, transparent);
  }

  .ambulatorio-card-shell:hover .ambulatorio-name,
  .ambulatorio-card-shell:focus-within .ambulatorio-name {
    color: var(--ambulatorio-primary);
  }

  .ambulatorio-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-4) 0;
    width: 100%;
    height: 100%;
  }

  .ambulatorio-icon {
    width: 168px;
    height: 168px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: visible;
  }

  .ambulatorio-logo {
    width: 168px;
    height: 168px;
    object-fit: contain;
  }

  .ambulatorio-icon-fallback {
    width: 100%;
    height: 100%;
    border-radius: var(--radius-xl);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-letter {
    font-size: var(--text-4xl);
    font-weight: 700;
    color: white;
  }

  .ambulatorio-name {
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--color-text);
    text-align: center;
    margin: 0;
    min-height: 3.5rem;
    line-height: 1.25;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow-wrap: anywhere;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (max-width: 700px) {
    .ambulatori-grid {
      width: 100%;
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
