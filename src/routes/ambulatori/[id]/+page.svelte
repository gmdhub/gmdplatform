<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { ambulatorioStore } from '$lib/stores/ambulatorio';
  import { authStore } from '$lib/stores/auth';
  import { sidebarCollapsedStore } from '$lib/stores/sidebar';
  import { toastStore } from '$lib/stores/toast';
  import { getPazientiByAmbulatorio } from '$lib/db/pazienti';
  import { getFattoriRischioCVByVisitaIds } from '$lib/db/fattori-rischio-cv';
  import { getCurrentVisiteByAmbulatorio } from '$lib/db/visite';
  import type { FattoriRischioCV, Visita } from '$lib/db/types';
  import {
    parseEsamiEmatici,
    parseTerapiaIpolipemizzante,
    parseValutazioneRischioCV
  } from '$lib/utils/visit-clinical';
  import { resolveAmbulatorioReportDirectory } from '$lib/utils/report-storage';
  import Card from '$lib/components/Card.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let totalPazienti = 0;
  let loading = true;

  type TherapyStat = {
    therapy: string;
    count: number;
  };

  type RiskLabel = 'Molto Alto' | 'Alto' | 'Moderato' | 'Basso';

  type RiskStat = {
    risk: RiskLabel;
    count: number;
  };

  type ComorbidityStat = {
    label: string;
    count: number;
    percentage: string | number;
  };

  type DashboardStats = {
    totalPatients: number;
    totalVisits: number | null;
    patientsAtTarget: number;
    patientsNotAtTarget: number;
    pcsk9Stats: {
      total: number;
      repatha: number;
      praluent: number;
      leqvio: number;
    };
    topTherapyStats: TherapyStat[];
    riskStats: RiskStat[];
    fdrcvStats: ComorbidityStat[];
  };

  $: ambulatorio = $ambulatorioStore.current;
  $: user = $authStore.user;
  $: ambulatorioId = $page.params.id;
  let dashboardStats: DashboardStats = createEmptyDashboardStats();

  const fallbackRiskOrder: RiskLabel[] = ['Molto Alto', 'Alto', 'Moderato', 'Basso'];
  const fallbackComorbidities = ['Diabete', 'Ipertensione', 'Obesità', 'Fumo', 'Familiarità'];
  const fallbackTopTherapies: TherapyStat[] = [
    { therapy: 'Statina', count: 0 },
    { therapy: 'Statina + Ezetimibe', count: 0 },
    { therapy: 'Ezetimibe', count: 0 },
    { therapy: 'Inibitori PCSK9', count: 0 },
    { therapy: 'Acido Bempedoico', count: 0 }
  ];

  const riskLabelMap: Record<'basso' | 'moderato' | 'alto' | 'molto_alto', RiskLabel> = {
    basso: 'Basso',
    moderato: 'Moderato',
    alto: 'Alto',
    molto_alto: 'Molto Alto'
  };

  function navigateToVisite() {
    console.log('Navigating to visite, ambulatorioId:', ambulatorioId);
    goto(`/ambulatori/${ambulatorioId}/visite?from=dashboard`);
  }

  function navigateToCercaPaziente() {
    console.log('Navigating to cerca paziente, ambulatorioId:', ambulatorioId);
    goto(`/ambulatori/${ambulatorioId}/pazienti?mode=search&from=dashboard`);
  }

  function navigateToNuovaVisita() {
    console.log('Navigating to nuova visita, ambulatorioId:', ambulatorioId);
    goto(`/ambulatori/${ambulatorioId}/visite/nuova?from=dashboard`);
  }

  function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    if (typeof error === 'string' && error.trim()) {
      return error;
    }

    return 'Errore sconosciuto';
  }

  async function navigateToCartellaReferti() {
    try {
      const ambulatorioName = ambulatorio?.nome || `Ambulatorio ${ambulatorioId}`;
      const reportDirectory = await resolveAmbulatorioReportDirectory(ambulatorioName);

      const [{ mkdir }, { openPath }] = await Promise.all([
        import('@tauri-apps/plugin-fs'),
        import('@tauri-apps/plugin-opener')
      ]);

      await mkdir(reportDirectory, { recursive: true });
      await openPath(reportDirectory);
    } catch (error) {
      console.error('Errore apertura cartella referti:', error);
      toastStore.show('error', `Impossibile aprire la cartella referti: ${getErrorMessage(error)}`);
    }
  }

  onMount(async () => {
    await loadDashboardData();
  });

  const getCurrentGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Buongiorno';
    if (hour < 18) return 'Buon pomeriggio';
    return 'Buonasera';
  };

  function createEmptyDashboardStats(totalPatients = 0): DashboardStats {
    return {
      totalPatients,
      totalVisits: null,
      patientsAtTarget: 0,
      patientsNotAtTarget: 0,
      pcsk9Stats: {
        total: 0,
        repatha: 0,
        praluent: 0,
        leqvio: 0
      },
      topTherapyStats: [],
      riskStats: [],
      fdrcvStats: []
    };
  }

  function incrementCounter(counter: Map<string, number>, key: string): void {
    counter.set(key, (counter.get(key) ?? 0) + 1);
  }

  function formatPercentage(value: number): string {
    if (!Number.isFinite(value)) return '0';
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  function getLatestVisiteByPaziente(visite: Visita[]): Visita[] {
    const latestByPaziente = new Map<number, Visita>();

    for (const visita of visite) {
      if (!latestByPaziente.has(visita.paziente_id)) {
        latestByPaziente.set(visita.paziente_id, visita);
      }
    }

    return Array.from(latestByPaziente.values());
  }

  function hasPositiveFumoValue(fumo: string): boolean {
    const normalized = fumo.trim().toLowerCase();
    return normalized !== '' && normalized !== 'no' && normalized !== '0' && normalized !== 'false';
  }

  async function loadDashboardData(): Promise<void> {
    loading = true;

    try {
      const parsedAmbulatorioId = Number.parseInt(String(ambulatorioId ?? ''), 10);
      if (!Number.isInteger(parsedAmbulatorioId)) {
        throw new Error('ID ambulatorio non valido');
      }

      const [pazientiAmbulatorio, visite] = await Promise.all([
        getPazientiByAmbulatorio(parsedAmbulatorioId),
        getCurrentVisiteByAmbulatorio(parsedAmbulatorioId)
      ]);
      totalPazienti = pazientiAmbulatorio.length;

      const latestVisite = getLatestVisiteByPaziente(visite);
      const fattoriRows = await getFattoriRischioCVByVisitaIds(latestVisite.map((visita) => visita.id));
      const fattoriByVisitaId = new Map<number, FattoriRischioCV>(
        fattoriRows.map((fattori) => [fattori.visita_id, fattori])
      );

      let patientsAtTarget = 0;
      let patientsNotAtTarget = 0;
      const pcsk9Stats = {
        total: 0,
        repatha: 0,
        praluent: 0,
        leqvio: 0
      };
      const therapyCounter = new Map<string, number>();
      const riskCounter = new Map<RiskLabel, number>(
        fallbackRiskOrder.map((risk) => [risk, 0])
      );
      const comorbidityCounter = new Map<string, number>(
        fallbackComorbidities.map((label) => [label, 0])
      );

      for (const visita of latestVisite) {
        const esami = parseEsamiEmatici(visita.esami_ematici);
        const valutazione = parseValutazioneRischioCV(visita.valutazione_rischio_cv, esami);
        if (valutazione.status === 'raggiunto') {
          patientsAtTarget += 1;
        } else if (valutazione.status === 'non_raggiunto') {
          patientsNotAtTarget += 1;
        }

        if (valutazione.rischio && riskLabelMap[valutazione.rischio]) {
          const label = riskLabelMap[valutazione.rischio];
          riskCounter.set(label, (riskCounter.get(label) ?? 0) + 1);
        }

        const terapia = parseTerapiaIpolipemizzante(visita.terapia_ipolipemizzante);
        const hasRepatha = terapia.repatha.enabled;
        const hasPraluent = terapia.praluent.enabled;
        const hasLeqvio = terapia.leqvio.enabled;
        const hasPcsk9 = hasRepatha || hasPraluent || hasLeqvio;

        if (hasRepatha) pcsk9Stats.repatha += 1;
        if (hasPraluent) pcsk9Stats.praluent += 1;
        if (hasLeqvio) pcsk9Stats.leqvio += 1;
        if (hasPcsk9) {
          pcsk9Stats.total += 1;
          incrementCounter(therapyCounter, 'Inibitori PCSK9');
        }

        if (terapia.statine.enabled && terapia.ezetimibe.enabled) {
          incrementCounter(therapyCounter, 'Statina + Ezetimibe');
        } else if (terapia.statine.enabled) {
          incrementCounter(therapyCounter, 'Statina');
        } else if (terapia.ezetimibe.enabled) {
          incrementCounter(therapyCounter, 'Ezetimibe');
        }

        if (terapia.acido_bempedoico.enabled) {
          incrementCounter(therapyCounter, 'Acido Bempedoico');
        }

        const fattori = fattoriByVisitaId.get(visita.id);
        if (!fattori) {
          continue;
        }

        if (fattori.diabete) {
          comorbidityCounter.set('Diabete', (comorbidityCounter.get('Diabete') ?? 0) + 1);
        }
        if (fattori.ipertensione) {
          comorbidityCounter.set('Ipertensione', (comorbidityCounter.get('Ipertensione') ?? 0) + 1);
        }
        if (fattori.obesita) {
          comorbidityCounter.set('Obesità', (comorbidityCounter.get('Obesità') ?? 0) + 1);
        }
        if (hasPositiveFumoValue(fattori.fumo)) {
          comorbidityCounter.set('Fumo', (comorbidityCounter.get('Fumo') ?? 0) + 1);
        }
        if (fattori.familiarita) {
          comorbidityCounter.set('Familiarità', (comorbidityCounter.get('Familiarità') ?? 0) + 1);
        }
      }

      const totalPatientsForPercentage = Math.max(totalPazienti, 1);
      const topTherapyStats = Array.from(therapyCounter.entries())
        .map(([therapy, count]) => ({ therapy, count }))
        .filter((item) => item.count > 0)
        .sort((left, right) => right.count - left.count || left.therapy.localeCompare(right.therapy));
      const riskStats = fallbackRiskOrder.map((risk) => ({
        risk,
        count: riskCounter.get(risk) ?? 0
      }));
      const fdrcvStats = fallbackComorbidities.map((label) => {
        const count = comorbidityCounter.get(label) ?? 0;
        return {
          label,
          count,
          percentage: formatPercentage((count / totalPatientsForPercentage) * 100)
        };
      });

      dashboardStats = {
        totalPatients: totalPazienti,
        totalVisits: visite.length,
        patientsAtTarget,
        patientsNotAtTarget,
        pcsk9Stats,
        topTherapyStats,
        riskStats,
        fdrcvStats
      };
    } catch (error) {
      console.error('Errore caricamento dati dashboard:', error);
      dashboardStats = createEmptyDashboardStats(totalPazienti);
    } finally {
      loading = false;
    }
  }

  function getTopTherapyItems(items: TherapyStat[]): TherapyStat[] {
    if (items.length > 0) return items.slice(0, 5);
    return fallbackTopTherapies;
  }

  function getRiskItems(items: RiskStat[]): RiskStat[] {
    if (items.length > 0) return items;
    return fallbackRiskOrder.map((risk) => ({ risk, count: 0 }));
  }

  function getComorbidityItems(items: ComorbidityStat[]): ComorbidityStat[] {
    if (items.length > 0) return items;

    return fallbackComorbidities.map((label) => ({
      label,
      count: 0,
      percentage: 0
    }));
  }
</script>

<div class="dashboard">
  <PageHeader
    title="{getCurrentGreeting()}, {user?.nome}"
    subtitle="Benvenuto in {ambulatorio?.nome || 'GMD Medical Platform'}"
    showLogo={$sidebarCollapsedStore}
  />

  <div class="dashboard-content">
    {#if loading}
      <div class="loading-state">Caricamento dati...</div>
    {:else}
      <div class="quick-actions">
        <h2 class="section-title">Strumenti</h2>
        <div class="actions-grid">
          <Card clickable hover on:click={navigateToCercaPaziente}>
            <div class="action-card">
              <div class="action-icon icon-container">
                <Icon name="search" size={48} strokeWidth={1.5} />
              </div>
              <div class="action-info">
                <div class="action-title">Cerca Paziente</div>
                <div class="action-description">Cerca un paziente e apri il suo percorso visite</div>
              </div>
            </div>
          </Card>

          <Card clickable hover on:click={navigateToVisite}>
            <div class="action-card">
              <div class="action-icon icon-container">
                <Icon name="file-text" size={48} strokeWidth={1.5} />
              </div>
              <div class="action-info">
                <div class="action-title">Archivio Visite</div>
                <div class="action-description">Visualizza e gestisci le visite mediche</div>
              </div>
            </div>
          </Card>

          <Card clickable hover on:click={navigateToNuovaVisita}>
            <div class="action-card">
              <div class="action-icon icon-container">
                <Icon name="file-plus" size={48} strokeWidth={1.5} />
              </div>
              <div class="action-info">
                <div class="action-title">Nuova Visita</div>
                <div class="action-description">Apri la procedura guidata per creare una nuova visita</div>
              </div>
            </div>
          </Card>

          <Card clickable hover on:click={navigateToCartellaReferti}>
            <div class="action-card">
              <div class="action-icon icon-container">
                <Icon name="folder-open" size={48} strokeWidth={1.5} />
              </div>
              <div class="action-info">
                <div class="action-title">Cartella Referti</div>
                <div class="action-description">Apri la cartella dove vengono salvati i referti</div>
              </div>
            </div>
          </Card>

          <Card clickable hover padding="lg">
            <div class="action-card disabled">
              <div class="action-icon icon-container">
                <Icon
                  name="pill"
                  size={56}
                  strokeWidth={1.5}
                  style="transform: rotate(45deg); transform-origin: 50% 50%;"
                />
              </div>
              <div class="action-info">
                <div class="action-title">Nuova Prescrizione</div>
                <div class="action-description">Crea una prescrizione medica</div>
              </div>
              <span class="badge-soon">Presto</span>
            </div>
          </Card>
        </div>
      </div>

      <div class="stats-section">
        <h2 class="section-title">Statistiche</h2>
        <div class="stats-grid">
          <Card padding="lg">
            <div class="stats-card-shell kpi-card">
              <div class="stats-card-title">Totale Pazienti</div>
              <div class="stats-kpi-value">{dashboardStats.totalPatients}</div>
            </div>
          </Card>

          <Card padding="lg">
            <div class="stats-card-shell kpi-card">
              <div class="stats-card-title">Totale Visite</div>
              <div class="stats-kpi-value">{dashboardStats.totalVisits ?? '-'}</div>
            </div>
          </Card>

          <Card padding="lg">
            <div class="stats-card-shell list-card">
              <div class="stats-card-title">Target Colesterolo LDL</div>
              <div class="stats-list">
                <div class="stats-list-row">
                  <span class="stats-list-label">Pazienti a Target</span>
                  <strong class="stats-list-value">{dashboardStats.patientsAtTarget}</strong>
                </div>
                <div class="stats-list-row">
                  <span class="stats-list-label">Pazienti non a Target</span>
                  <strong class="stats-list-value">{dashboardStats.patientsNotAtTarget}</strong>
                </div>
              </div>
            </div>
          </Card>

          <Card padding="lg">
            <div class="stats-card-shell detail-card">
              <div class="stats-card-title">Pazienti con Inibitori PCSK9</div>
              <div class="stats-detail-top">
                <div class="stats-kpi-value">{dashboardStats.pcsk9Stats.total}</div>
              </div>
              <div class="stats-list">
                <div class="stats-list-row">
                  <span class="stats-list-label">Repatha</span>
                  <strong class="stats-list-value">{dashboardStats.pcsk9Stats.repatha}</strong>
                </div>
                <div class="stats-list-row">
                  <span class="stats-list-label">Praluent</span>
                  <strong class="stats-list-value">{dashboardStats.pcsk9Stats.praluent}</strong>
                </div>
                <div class="stats-list-row">
                  <span class="stats-list-label">Leqvio</span>
                  <strong class="stats-list-value">{dashboardStats.pcsk9Stats.leqvio}</strong>
                </div>
              </div>
            </div>
          </Card>

          <Card padding="lg">
            <div class="stats-card-shell list-card">
              <div class="stats-card-title">Pazienti per Terapia (Top)</div>
              <div class="stats-list">
                {#each getTopTherapyItems(dashboardStats.topTherapyStats) as item}
                  <div class="stats-list-row">
                    <span class="stats-list-label">{item.therapy}</span>
                    <strong class="stats-list-value">{item.count}</strong>
                  </div>
                {/each}
              </div>
            </div>
          </Card>

          <Card padding="lg">
            <div class="stats-card-shell list-card">
              <div class="stats-card-title">Rischio CV</div>
              <div class="stats-list">
                {#each getRiskItems(dashboardStats.riskStats) as item}
                  <div class="stats-list-row">
                    <span class="stats-list-label">{item.risk}</span>
                    <strong class="stats-list-value">{item.count}</strong>
                  </div>
                {/each}
              </div>
            </div>
          </Card>

          <Card padding="lg">
            <div class="stats-card-shell list-card">
              <div class="stats-card-title">Comorbidità</div>
              <div class="stats-list">
                {#each getComorbidityItems(dashboardStats.fdrcvStats) as item}
                  <div class="stats-list-row">
                    <span class="stats-list-label">{item.label}</span>
                    <strong class="stats-list-value">{item.count} ({item.percentage}%)</strong>
                  </div>
                {/each}
              </div>
            </div>
          </Card>
        </div>
      </div>

      <div class="recent-activity">
        <h2 class="section-title">Attività Recente</h2>
        <Card padding="lg">
          <div class="empty-state">
            <div class="empty-icon">
              <Icon name="chart" size={64} strokeWidth={1.5} />
            </div>
            <p class="empty-text">Nessuna attività recente da visualizzare</p>
            <p class="empty-subtext">Le attività appariranno qui quando ci saranno nuovi eventi</p>
          </div>
        </Card>
      </div>
    {/if}
  </div>
</div>

<style>
  .dashboard {
    min-height: 100vh;
    padding: var(--space-8);
  }

  .dashboard-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  .loading-state {
    text-align: center;
    padding: var(--space-12);
    color: var(--color-text-secondary);
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: var(--space-6);
  }

  .stats-card-shell {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-height: 100%;
  }

  .stats-card-title {
    font-size: var(--text-base);
    font-weight: 700;
    color: var(--color-text);
    line-height: 1.35;
    text-align: center;
  }

  .stats-kpi-value {
    font-size: clamp(2rem, 3vw, 2.8rem);
    font-weight: 700;
    color: var(--color-primary);
    line-height: 1;
  }

  .kpi-card .stats-kpi-value,
  .detail-card .stats-kpi-value {
    text-align: center;
  }

  .stats-detail-top {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .stats-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .stats-list-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--color-border);
  }

  .stats-list-row:last-child {
    padding-bottom: 0;
    border-bottom: none;
  }

  .stats-list-label {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: 1.4;
  }

  .stats-list-value {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--color-text);
    text-align: right;
    white-space: nowrap;
  }

  .section-title {
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--color-text);
    margin: 0 0 var(--space-4) 0;
  }

  .actions-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-6);
  }

  .action-card {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    padding: var(--space-6);
    position: relative;
  }

  .action-card.disabled {
    opacity: 0.6;
  }

  .action-icon {
    width: 80px;
    height: 80px;
    flex-shrink: 0;
    color: var(--color-primary);
    background-color: color-mix(in srgb, var(--color-primary) 12%, var(--color-bg-secondary));
    border: 1px solid color-mix(in srgb, var(--color-primary) 20%, transparent);
  }

  .action-icon :global(.icon-svg) {
    color: currentColor;
  }

  :global(.card:hover) .action-icon {
    color: var(--color-secondary);
    background-color: color-mix(in srgb, var(--color-primary) 18%, var(--color-bg-tertiary));
    border-color: color-mix(in srgb, var(--color-primary) 32%, transparent);
  }

  .action-info {
    flex: 1;
  }

  .action-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--color-text);
    margin-bottom: var(--space-1);
  }

  .action-description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .badge-soon {
    position: absolute;
    top: var(--space-3);
    right: var(--space-3);
    font-size: var(--text-xs);
    padding: var(--space-1) var(--space-2);
    background-color: var(--color-accent);
    color: white;
    border-radius: var(--radius-full);
    font-weight: 600;
  }

  .empty-state {
    text-align: center;
    padding: var(--space-12);
  }

  .empty-icon {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: var(--space-4);
    color: var(--color-text-tertiary);
  }

  .empty-icon :global(.icon-svg) {
    width: 64px;
    height: 64px;
    stroke-width: 1.5;
    opacity: 0.5;
  }

  .empty-text {
    font-size: var(--text-base);
    color: var(--color-text);
    margin: 0 0 var(--space-2) 0;
  }

  .empty-subtext {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
  }

  @media (max-width: 960px) {
    .actions-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
