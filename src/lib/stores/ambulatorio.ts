// GMD Medical Platform - Ambulatorio Store
import { writable } from 'svelte/store';
import type { Ambulatorio } from '$lib/db/types';
import { ensureStorageIsolationForEnvironment, getScopedStorageKey } from '$lib/db/config';

const AMBULATORIO_STORAGE_KEY_BASE = 'gmd_ambulatorio';

interface AmbulatorioState {
  current: Ambulatorio | null;
}

function createAmbulatorioStore() {
  const { subscribe, set, update } = writable<AmbulatorioState>({
    current: null
  });

  return {
    subscribe,
    select: (ambulatorio: Ambulatorio) => {
      set({ current: ambulatorio });

      // Applica tema
      if (typeof document !== 'undefined') {
        document.documentElement.style.setProperty('--color-primary', ambulatorio.color_primary);
        document.documentElement.style.setProperty('--color-secondary', ambulatorio.color_secondary);
        document.documentElement.style.setProperty('--color-accent', ambulatorio.color_accent);
      }

      // Salva in sessionStorage
      if (typeof window !== 'undefined') {
        ensureStorageIsolationForEnvironment();
        sessionStorage.setItem(getScopedStorageKey(AMBULATORIO_STORAGE_KEY_BASE), JSON.stringify(ambulatorio));
      }
    },
    clear: () => {
      set({ current: null });
      if (typeof window !== 'undefined') {
        ensureStorageIsolationForEnvironment();
        sessionStorage.removeItem(getScopedStorageKey(AMBULATORIO_STORAGE_KEY_BASE));
        sessionStorage.removeItem(AMBULATORIO_STORAGE_KEY_BASE);
      }
    },
    restore: () => {
      if (typeof window !== 'undefined') {
        ensureStorageIsolationForEnvironment();
        const stored = sessionStorage.getItem(getScopedStorageKey(AMBULATORIO_STORAGE_KEY_BASE));
        if (stored) {
          const ambulatorio = JSON.parse(stored);
          set({ current: ambulatorio });

          // Riapplica tema
          if (typeof document !== 'undefined') {
            document.documentElement.style.setProperty('--color-primary', ambulatorio.color_primary);
            document.documentElement.style.setProperty('--color-secondary', ambulatorio.color_secondary);
            document.documentElement.style.setProperty('--color-accent', ambulatorio.color_accent);
          }
        }
      }
    }
  };
}

export const ambulatorioStore = createAmbulatorioStore();
