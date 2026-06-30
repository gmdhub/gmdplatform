<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { ambulatorioStore } from '$lib/stores/ambulatorio';
  import { authStore } from '$lib/stores/auth';
  import type { IconName } from './icon-names';
  import Icon from './Icon.svelte';

  export let ambulatorioId: number;
  export let collapsed: boolean = false;

  $: currentPath = $page.url.pathname;
  $: currentMode = $page.url.searchParams.get('mode');
  $: currentFrom = $page.url.searchParams.get('from');
  $: ambulatorio = $ambulatorioStore.current;
  $: user = $authStore.user;

  type SidebarMenuItem = {
    id: string;
    label: string;
    icon: IconName;
    path: string;
    disabled?: boolean;
  };

  const menuItems: SidebarMenuItem[] = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: 'layout-grid',
      path: `/ambulatori/${ambulatorioId}`
    },
    {
      id: 'pazienti',
      label: 'Gestione Anagrafica',
      icon: 'users',
      path: `/ambulatori/${ambulatorioId}/pazienti`
    },
    {
      id: 'appuntamenti',
      label: 'Calendario',
      icon: 'calendar-days',
      path: `/ambulatori/${ambulatorioId}/appuntamenti`
    },
    {
      id: 'cartelle',
      label: 'Cartelle Cliniche',
      icon: 'file-text',
      path: `/ambulatori/${ambulatorioId}/cartelle`,
      disabled: true
    },
    {
      id: 'prescrizioni',
      label: 'Prescrizioni',
      icon: 'clipboard-plus',
      path: `/ambulatori/${ambulatorioId}/prescrizioni`,
      disabled: true
    },
    {
      id: 'fatturazione',
      label: 'Fatturazione',
      icon: 'receipt',
      path: `/ambulatori/${ambulatorioId}/fatturazione`,
      disabled: true
    },
    {
      id: 'impostazioni',
      label: 'Impostazioni',
      icon: 'settings',
      path: `/ambulatori/${ambulatorioId}/impostazioni`
    }
  ];

  function isActive(itemPath: string): boolean {
    const gestioneAnagraficaPath = `/ambulatori/${ambulatorioId}/pazienti`;
    const dashboardPath = `/ambulatori/${ambulatorioId}`;

    if (currentFrom === 'dashboard') {
      return itemPath === dashboardPath;
    }

    if (itemPath === gestioneAnagraficaPath && currentMode === 'search') {
      return false;
    }

    // Exact match per la dashboard (es. /ambulatori/1)
    if (itemPath === dashboardPath) {
      return currentPath === itemPath;
    }
    // Per le altre pagine, controlla se il path corrente inizia con il path dell'item
    return currentPath === itemPath || currentPath.startsWith(itemPath + '/');
  }

  function handleNavigation(item: SidebarMenuItem) {
    if (!item.disabled) {
      goto(item.path);
    }
  }

  function handleLogout() {
    authStore.logout();
    goto('/');
  }

  function goBackToAmbulatori() {
    goto('/ambulatori');
  }
</script>

<aside class="sidebar" class:collapsed>
  <div class="sidebar-header">
    <img src="/logo_aziendale.png" alt="GMD Medical" class="logo" />
    <h2 class="ambulatorio-name">{ambulatorio?.nome || ''}</h2>
  </div>

  <nav class="sidebar-nav">
    {#each menuItems as item}
      <button
        class="nav-item"
        class:active={isActive(item.path)}
        class:disabled={item.disabled}
        on:click={() => handleNavigation(item)}
        disabled={item.disabled}
      >
        <span class="nav-icon"><Icon name={item.icon} size={20} /></span>
        <span class="nav-label">{item.label}</span>
        {#if item.disabled}
          <span class="badge">Presto</span>
        {/if}
      </button>
    {/each}
  </nav>

  <div class="sidebar-footer">
    <div class="user-info">
      <div class="user-avatar">
        {user?.nome?.charAt(0) || 'U'}{user?.cognome?.charAt(0) || ''}
      </div>
      <div class="user-details">
        <div class="user-name">{user?.nome} {user?.cognome}</div>
        <div class="user-role">{user?.role}</div>
      </div>
    </div>
    <button class="btn-change-ambulatorio" on:click={goBackToAmbulatori}>
      <Icon name="arrow-left" size={16} />
      Cambia Ambulatorio
    </button>
    <button class="btn-logout" on:click={handleLogout}>
      <Icon name="log-out" size={16} />
      Logout
    </button>
  </div>
</aside>

<style>
  .sidebar {
    width: 16rem;
    height: 100vh;
    background-color: var(--color-bg);
    border-right: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    position: fixed;
    left: 0;
    top: 0;
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 100;
  }

  .sidebar.collapsed {
    transform: translateX(-100%);
  }

  .sidebar-header {
    padding: var(--space-6);
    border-bottom: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
  }

  .logo {
    height: 120px;
    width: auto;
  }

  .ambulatorio-name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-secondary);
    margin: 0;
    text-align: center;
  }

  .sidebar-nav {
    flex: 1;
    padding: var(--space-4);
    overflow-y: auto;
  }

  .nav-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    margin-bottom: 2px;
    background: none;
    border: none;
    border-radius: var(--radius-md);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: 400;
    color: var(--color-text-secondary);
    text-align: left;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .nav-item:hover:not(.disabled) {
    background-color: color-mix(in srgb, var(--color-primary) 8%, var(--color-bg-secondary));
    color: var(--color-text);
  }

  .nav-item.active {
    background-color: color-mix(in srgb, var(--color-primary) 12%, var(--color-bg-secondary));
    color: var(--color-text);
    font-weight: 500;
    border-left: 3px solid var(--color-primary);
    padding-left: calc(var(--space-3) - 3px);
  }

  .nav-item.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .nav-icon {
    width: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-primary);
    opacity: 0.78;
  }

  .nav-item.active .nav-icon {
    color: var(--color-secondary);
    opacity: 1;
  }

  .nav-icon :global(.icon-svg) {
    width: 20px;
    height: 20px;
    color: currentColor;
  }

  .nav-label {
    flex: 1;
  }

  .badge {
    font-size: var(--text-xs);
    padding: 2px var(--space-2);
    background-color: var(--color-bg-tertiary);
    color: var(--color-text-secondary);
    border-radius: var(--radius-full);
    font-weight: 500;
  }

  .sidebar-footer {
    padding: var(--space-3);
    border-top: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .user-info {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    background-color: var(--color-bg-secondary);
    border-radius: var(--radius-md);
  }

  .user-avatar {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
    background-color: var(--color-primary);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: var(--text-xs);
  }

  .user-details {
    flex: 1;
  }

  .user-name {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text);
  }

  .user-role {
    font-size: 10px;
    color: var(--color-text-secondary);
    text-transform: capitalize;
  }

  .btn-change-ambulatorio,
  .btn-logout {
    width: 100%;
    padding: var(--space-2);
    background: none;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--color-text);
    cursor: pointer;
    transition: all var(--transition-fast);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
  }

  .btn-logout :global(.icon-svg) {
    width: 16px;
    height: 16px;
  }

  .btn-change-ambulatorio:hover {
    background-color: var(--color-bg-secondary);
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  .btn-logout:hover {
    background-color: var(--color-error);
    border-color: var(--color-error);
    color: white;
  }
</style>
