<script lang="ts">
  import {
    findFirstQuarterHourSlot,
    findFirstUrgentSlot,
    getSlotDisponibilitaByDay
  } from '$lib/db/appuntamenti';
  import { toastStore } from '$lib/stores/toast';
  import type {
    AppuntamentoSlotDisponibilita,
    FirstSlotSearchMode,
    PianificazioneFollowUp
  } from '$lib/db/types';
  import { createEmptyPianificazioneFollowUp } from '$lib/utils/visit-clinical';
  import Card from '../Card.svelte';
  import Textarea from '../Textarea.svelte';

  export let conclusioni = '';
  export let pianificazioneFollowUp: PianificazioneFollowUp = createEmptyPianificazioneFollowUp();
  export let ambulatorioId: number | null = null;
  export let showSlotSearchMonthsSelector = false;

  type FollowUpSegment = 'day' | 'month' | 'year' | 'hour' | 'minute';

  const followUpSegmentLengths: Record<FollowUpSegment, number> = {
    day: 2,
    month: 2,
    year: 4,
    hour: 2,
    minute: 2
  };

  const followUpSegmentOrder: FollowUpSegment[] = ['day', 'month', 'year', 'hour', 'minute'];
  const slotSearchMonthsOptions = [0, 1, 2, 3, 6, 9, 12];

  let followUpDay = '';
  let followUpMonth = '';
  let followUpYear = '';
  let followUpHour = '';
  let followUpMinute = '';
  let followUpDateForSlots = '';
  let selectedFollowUpTime = '';
  let followUpDayInput: HTMLInputElement | undefined;
  let followUpMonthInput: HTMLInputElement | undefined;
  let followUpYearInput: HTMLInputElement | undefined;
  let followUpHourInput: HTMLInputElement | undefined;
  let followUpMinuteInput: HTMLInputElement | undefined;
  let lastSyncedFollowUpValue: string | null = null;
  let slotLookupKey = '';
  let loadingSlotDisponibilita = false;
  let slotDisponibilita: AppuntamentoSlotDisponibilita[] = [];
  let slotDisponibilitaError = '';
  let searchingFirstSlotMode: FirstSlotSearchMode | null = null;
  let nextUrgentSearchCursor: string | null = null;
  let nextQuarterHourSearchCursor: string | null = null;
  let slotSearchStartOffsetMonths = 0;

  $: if (pianificazioneFollowUp.dataOraProssimaVisita !== lastSyncedFollowUpValue) {
    syncFollowUpSegments(pianificazioneFollowUp.dataOraProssimaVisita);
    lastSyncedFollowUpValue = pianificazioneFollowUp.dataOraProssimaVisita;
  }
  $: followUpDateForSlots = buildFollowUpDateOnlyValue();
  $: selectedFollowUpTime = resolveFollowUpTime(pianificazioneFollowUp.dataOraProssimaVisita);
  $: {
    const nextLookupKey =
      ambulatorioId && followUpDateForSlots
        ? `${ambulatorioId}:${followUpDateForSlots}`
        : '';

    if (slotLookupKey !== nextLookupKey) {
      slotLookupKey = nextLookupKey;
      void loadSlotDisponibilita(nextLookupKey, followUpDateForSlots);
    }
  }
  $: if (!ambulatorioId) {
    nextUrgentSearchCursor = null;
    nextQuarterHourSearchCursor = null;
  }

  function sanitizeFollowUpSegment(segment: FollowUpSegment, value: string): string {
    return value.replace(/\D/g, '').slice(0, followUpSegmentLengths[segment]);
  }

  function getFollowUpSegmentValue(segment: FollowUpSegment): string {
    switch (segment) {
      case 'day':
        return followUpDay;
      case 'month':
        return followUpMonth;
      case 'year':
        return followUpYear;
      case 'hour':
        return followUpHour;
      case 'minute':
        return followUpMinute;
    }
  }

  function setFollowUpSegmentValue(segment: FollowUpSegment, value: string) {
    switch (segment) {
      case 'day':
        followUpDay = value;
        break;
      case 'month':
        followUpMonth = value;
        break;
      case 'year':
        followUpYear = value;
        break;
      case 'hour':
        followUpHour = value;
        break;
      case 'minute':
        followUpMinute = value;
        break;
    }
  }

  function getFollowUpSegmentInput(segment: FollowUpSegment): HTMLInputElement | undefined {
    switch (segment) {
      case 'day':
        return followUpDayInput;
      case 'month':
        return followUpMonthInput;
      case 'year':
        return followUpYearInput;
      case 'hour':
        return followUpHourInput;
      case 'minute':
        return followUpMinuteInput;
    }
  }

  function focusFollowUpSegment(segment: FollowUpSegment) {
    const input = getFollowUpSegmentInput(segment);
    if (!input) return;

    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  function focusNextFollowUpSegment(segment: FollowUpSegment) {
    const currentIndex = followUpSegmentOrder.indexOf(segment);
    const nextSegment = followUpSegmentOrder[currentIndex + 1];
    if (!nextSegment) return;
    focusFollowUpSegment(nextSegment);
  }

  function focusPreviousFollowUpSegment(segment: FollowUpSegment) {
    const currentIndex = followUpSegmentOrder.indexOf(segment);
    const previousSegment = followUpSegmentOrder[currentIndex - 1];
    if (!previousSegment) return;
    focusFollowUpSegment(previousSegment);
  }

  function syncFollowUpSegments(value: string) {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);

    if (!match) {
      followUpDay = '';
      followUpMonth = '';
      followUpYear = '';
      followUpHour = '';
      followUpMinute = '';
      return;
    }

    followUpYear = match[1];
    followUpMonth = match[2];
    followUpDay = match[3];
    followUpHour = match[4];
    followUpMinute = match[5];
  }

  function buildFollowUpDateTimeValue(): string {
    if (
      followUpDay.length !== followUpSegmentLengths.day ||
      followUpMonth.length !== followUpSegmentLengths.month ||
      followUpYear.length !== followUpSegmentLengths.year ||
      followUpHour.length !== followUpSegmentLengths.hour ||
      followUpMinute.length !== followUpSegmentLengths.minute
    ) {
      return '';
    }

    const day = Number(followUpDay);
    const month = Number(followUpMonth);
    const year = Number(followUpYear);
    const hour = Number(followUpHour);
    const minute = Number(followUpMinute);

    if (
      Number.isNaN(day) ||
      Number.isNaN(month) ||
      Number.isNaN(year) ||
      Number.isNaN(hour) ||
      Number.isNaN(minute) ||
      day < 1 ||
      month < 1 ||
      month > 12 ||
      hour > 23 ||
      minute > 59
    ) {
      return '';
    }

    const date = new Date(year, month - 1, day, hour, minute);
    const isValidDate =
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day &&
      date.getHours() === hour &&
      date.getMinutes() === minute;

    if (!isValidDate) {
      return '';
    }

    return `${followUpYear}-${followUpMonth}-${followUpDay}T${followUpHour}:${followUpMinute}`;
  }

  function buildFollowUpDateOnlyValue(): string {
    if (
      followUpDay.length !== followUpSegmentLengths.day ||
      followUpMonth.length !== followUpSegmentLengths.month ||
      followUpYear.length !== followUpSegmentLengths.year
    ) {
      return '';
    }

    const day = Number(followUpDay);
    const month = Number(followUpMonth);
    const year = Number(followUpYear);

    if (
      Number.isNaN(day) ||
      Number.isNaN(month) ||
      Number.isNaN(year) ||
      day < 1 ||
      month < 1 ||
      month > 12
    ) {
      return '';
    }

    const date = new Date(year, month - 1, day);
    const isValidDate =
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day;

    if (!isValidDate) {
      return '';
    }

    return `${followUpYear}-${followUpMonth}-${followUpDay}`;
  }

  function syncFollowUpDateTimeValue() {
    const nextValue = buildFollowUpDateTimeValue();
    if (nextValue === pianificazioneFollowUp.dataOraProssimaVisita) return;
    lastSyncedFollowUpValue = nextValue;
    updatePianificazioneField('dataOraProssimaVisita', nextValue);
  }

  function handleFollowUpSegmentInput(segment: FollowUpSegment, event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const nextValue = sanitizeFollowUpSegment(segment, target.value);

    setFollowUpSegmentValue(segment, nextValue);
    target.value = nextValue;
    syncFollowUpDateTimeValue();

    if (nextValue.length === followUpSegmentLengths[segment]) {
      focusNextFollowUpSegment(segment);
    }
  }

  function handleFollowUpSegmentKeyDown(segment: FollowUpSegment, event: KeyboardEvent) {
    const target = event.currentTarget as HTMLInputElement;
    const selectionStart = target.selectionStart ?? 0;
    const selectionEnd = target.selectionEnd ?? 0;
    const currentValue = getFollowUpSegmentValue(segment);

    if (event.key === 'Backspace' && currentValue.length === 0) {
      event.preventDefault();
      focusPreviousFollowUpSegment(segment);
      return;
    }

    if (event.key === 'ArrowLeft' && selectionStart === 0 && selectionEnd === 0) {
      event.preventDefault();
      focusPreviousFollowUpSegment(segment);
      return;
    }

    if (
      event.key === 'ArrowRight' &&
      selectionStart === currentValue.length &&
      selectionEnd === currentValue.length
    ) {
      event.preventDefault();
      focusNextFollowUpSegment(segment);
    }
  }

  function updatePianificazioneField<K extends keyof PianificazioneFollowUp>(field: K, value: string) {
    if (pianificazioneFollowUp[field] === value) return;

    pianificazioneFollowUp = {
      ...pianificazioneFollowUp,
      [field]: value
    };
  }

  function resolveFollowUpTime(value: string): string {
    const match = value.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/);
    if (!match) {
      return '';
    }

    return `${match[1]}:${match[2]}`;
  }

  async function loadSlotDisponibilita(requestKey: string, day: string): Promise<void> {
    if (!requestKey || !ambulatorioId || !day) {
      slotDisponibilita = [];
      slotDisponibilitaError = '';
      loadingSlotDisponibilita = false;
      return;
    }

    loadingSlotDisponibilita = true;
    slotDisponibilitaError = '';

    try {
      const slots = await getSlotDisponibilitaByDay({
        ambulatorioId,
        day
      });

      if (requestKey !== slotLookupKey) {
        return;
      }

      slotDisponibilita = slots;
    } catch (error) {
      if (requestKey !== slotLookupKey) {
        return;
      }

      slotDisponibilita = [];
      slotDisponibilitaError =
        error instanceof Error && error.message
          ? error.message
          : 'Errore caricamento disponibilità slot';
    } finally {
      if (requestKey === slotLookupKey) {
        loadingSlotDisponibilita = false;
      }
    }
  }

  function handleSlotClick(slot: AppuntamentoSlotDisponibilita): void {
    if (!slot.available) {
      return;
    }

    const [hours, minutes] = slot.time.split(':');
    if (!hours || !minutes) {
      return;
    }

    followUpHour = hours;
    followUpMinute = minutes;
    syncFollowUpDateTimeValue();
    focusFollowUpSegment('minute');
  }

  function formatDateTimeForMessage(value: string): string {
    return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)} ${value.slice(11, 16)}`;
  }

  function resolveSlotSearchStartDateTime(): string {
    const offsetMonths = Number(slotSearchStartOffsetMonths);
    if (!Number.isFinite(offsetMonths) || offsetMonths <= 0) {
      return formatDateTimeForSearch(new Date());
    }

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() + Math.floor(offsetMonths));
    return formatDateTimeForSearch(startDate);
  }

  function formatDateTimeForSearch(date: Date): string {
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  async function handleFindFirstSlot(mode: FirstSlotSearchMode, searchNext = false): Promise<void> {
    if (!ambulatorioId || searchingFirstSlotMode) {
      return;
    }

    searchingFirstSlotMode = mode;
    try {
      const fromDateTime = searchNext
        ? (mode === 'urgent'
            ? (nextUrgentSearchCursor ?? undefined)
            : (nextQuarterHourSearchCursor ?? undefined))
        : resolveSlotSearchStartDateTime();
      const result =
        mode === 'urgent'
          ? await findFirstUrgentSlot({ ambulatorioId, fromDateTime })
          : await findFirstQuarterHourSlot({ ambulatorioId, fromDateTime });

      if (!result.found || !result.startDateTime) {
        const monthsLabel =
          Number(slotSearchStartOffsetMonths) <= 0
            ? 'da ora'
            : Number(slotSearchStartOffsetMonths) === 1
              ? 'a partire da 1 mese'
              : `a partire da ${slotSearchStartOffsetMonths} mesi`;
        toastStore.show(
          'info',
          result.reasonIfNotFound || `Nessuno slot disponibile trovato ${monthsLabel}.`
        );
        return;
      }

      syncFollowUpSegments(result.startDateTime);
      updatePianificazioneField('dataOraProssimaVisita', result.startDateTime);
      focusFollowUpSegment('minute');

      if (mode === 'urgent') {
        nextUrgentSearchCursor = result.endDateTime ?? result.startDateTime;
      } else {
        nextQuarterHourSearchCursor = result.endDateTime ?? result.startDateTime;
      }

      const endLabel = result.endDateTime ? ` - ${result.endDateTime.slice(11, 16)}` : '';
      const slotLabel =
        mode === 'urgent'
          ? (searchNext ? 'Slot urgente successivo' : 'Primo slot urgente')
          : (searchNext ? 'Slot disponibile successivo' : 'Primo slot disponibile');
      toastStore.show(
        'success',
        `${slotLabel} trovato: ${formatDateTimeForMessage(result.startDateTime)}${endLabel}`
      );

      if (mode === 'urgent' && result.requiresAdjustmentHint) {
        toastStore.show(
          'info',
          'Lo slot urgente richiederà conferma degli aggiustamenti anti-overlap al salvataggio.'
        );
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : 'Errore durante la ricerca slot';
      toastStore.show('error', message);
    } finally {
      searchingFirstSlotMode = null;
    }
  }
</script>

<Card>
  <h2 class="section-title">Conclusioni</h2>

  <div class="anamnesi-content">
    <Textarea
      id="conclusioni"
      bind:value={conclusioni}
      placeholder="Inserisci le conclusioni..."
      rows={6}
    />

    <div class="follow-up-section">
      <h3 class="follow-up-title">Prossima visita</h3>

      <div class="follow-up-grid">
        <div class="follow-up-field">
          <label
            id="data_ora_prossima_visita_label"
            for="data_ora_prossima_visita_giorno"
            class="follow-up-label"
          >
            Data e ora prossima visita
          </label>
          <div
            class="follow-up-datetime"
            role="group"
            aria-labelledby="data_ora_prossima_visita_label"
          >
            <div class="follow-up-segment-group">
              <input
                id="data_ora_prossima_visita_giorno"
                bind:this={followUpDayInput}
                class="follow-up-segment"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                maxlength={followUpSegmentLengths.day}
                placeholder="GG"
                aria-label="Giorno prossima visita"
                value={followUpDay}
                on:input={(event) => handleFollowUpSegmentInput('day', event)}
                on:keydown={(event) => handleFollowUpSegmentKeyDown('day', event)}
              />
              <span class="follow-up-separator" aria-hidden="true">/</span>
              <input
                bind:this={followUpMonthInput}
                class="follow-up-segment"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                maxlength={followUpSegmentLengths.month}
                placeholder="MM"
                aria-label="Mese prossima visita"
                value={followUpMonth}
                on:input={(event) => handleFollowUpSegmentInput('month', event)}
                on:keydown={(event) => handleFollowUpSegmentKeyDown('month', event)}
              />
              <span class="follow-up-separator" aria-hidden="true">/</span>
              <input
                bind:this={followUpYearInput}
                class="follow-up-segment follow-up-segment-year"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                maxlength={followUpSegmentLengths.year}
                placeholder="AAAA"
                aria-label="Anno prossima visita"
                value={followUpYear}
                on:input={(event) => handleFollowUpSegmentInput('year', event)}
                on:keydown={(event) => handleFollowUpSegmentKeyDown('year', event)}
              />
            </div>

            <div class="follow-up-segment-group">
              <input
                bind:this={followUpHourInput}
                class="follow-up-segment"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                maxlength={followUpSegmentLengths.hour}
                placeholder="HH"
                aria-label="Ora prossima visita"
                value={followUpHour}
                on:input={(event) => handleFollowUpSegmentInput('hour', event)}
                on:keydown={(event) => handleFollowUpSegmentKeyDown('hour', event)}
              />
              <span class="follow-up-separator" aria-hidden="true">:</span>
              <input
                bind:this={followUpMinuteInput}
                class="follow-up-segment"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                maxlength={followUpSegmentLengths.minute}
                placeholder="MM"
                aria-label="Minuti prossima visita"
                value={followUpMinute}
                on:input={(event) => handleFollowUpSegmentInput('minute', event)}
                on:keydown={(event) => handleFollowUpSegmentKeyDown('minute', event)}
              />
            </div>
          </div>

          <div class="follow-up-actions">
            {#if showSlotSearchMonthsSelector}
              <div class="follow-up-months-control">
                <label for="follow_up_slot_months" class="follow-up-label">Cerca a partire da</label>
                <div class="follow-up-months-input-wrap">
                  <select
                    id="follow_up_slot_months"
                    class="follow-up-months-select"
                    bind:value={slotSearchStartOffsetMonths}
                  >
                    {#each slotSearchMonthsOptions as months}
                      <option value={months}>
                        {months === 0 ? 'Subito' : `${months} ${months === 1 ? 'mese' : 'mesi'}`}
                      </option>
                    {/each}
                  </select>
                </div>
              </div>
            {/if}
            <button
              type="button"
              class="follow-up-action-btn"
              on:click={() => handleFindFirstSlot('urgent')}
              disabled={Boolean(searchingFirstSlotMode) || !ambulatorioId}
            >
              {searchingFirstSlotMode === 'urgent' ? 'Ricerca slot urgente...' : 'Primo slot urgente'}
            </button>
            <button
              type="button"
              class="follow-up-action-btn"
              on:click={() => handleFindFirstSlot('urgent', true)}
              disabled={Boolean(searchingFirstSlotMode) || !ambulatorioId || !nextUrgentSearchCursor}
            >
              Slot urgente successivo
            </button>
            <button
              type="button"
              class="follow-up-action-btn"
              on:click={() => handleFindFirstSlot('quarter_hour')}
              disabled={Boolean(searchingFirstSlotMode) || !ambulatorioId}
            >
              {searchingFirstSlotMode === 'quarter_hour'
                ? 'Ricerca slot disponibile...'
                : 'Primo slot disponibile'}
            </button>
            <button
              type="button"
              class="follow-up-action-btn"
              on:click={() => handleFindFirstSlot('quarter_hour', true)}
              disabled={Boolean(searchingFirstSlotMode) || !ambulatorioId || !nextQuarterHourSearchCursor}
            >
              Slot disponibile successivo
            </button>
          </div>

          <div class="follow-up-slots">
            <div class="follow-up-slots-title">Slot disponibili in base agli orari dell'ambulatorio</div>

            {#if !followUpDateForSlots}
              <p class="follow-up-slots-hint">Completa la data per vedere gli slot liberi.</p>
            {:else if loadingSlotDisponibilita}
              <p class="follow-up-slots-hint">Caricamento disponibilità...</p>
            {:else if slotDisponibilitaError}
              <p class="follow-up-slots-error">{slotDisponibilitaError}</p>
            {:else if slotDisponibilita.length === 0}
              <p class="follow-up-slots-hint">Nessuno slot disponibile per il giorno selezionato.</p>
            {:else}
              <div class="follow-up-slots-grid">
                {#each slotDisponibilita as slot}
                  <button
                    type="button"
                    class="follow-up-slot-btn"
                    class:available={slot.available}
                    class:occupied={!slot.available}
                    class:selected={slot.available && selectedFollowUpTime === slot.time}
                    disabled={!slot.available}
                    on:click={() => handleSlotClick(slot)}
                    title={slot.available
                      ? `Seleziona ${slot.time}`
                      : `Occupato${slot.appuntamento
                        ? `: ${slot.appuntamento.paziente_cognome || ''} ${slot.appuntamento.paziente_nome || ''}`.trim()
                        : ''}`}
                  >
                    {slot.time}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>

        <div class="follow-up-field">
          <label for="motivo_prossima_visita" class="follow-up-label">Motivo prossima visita</label>
          <input
            id="motivo_prossima_visita"
            class="follow-up-input"
            type="text"
            value={pianificazioneFollowUp.motivoProssimaVisita}
            placeholder="Inserisci il motivo della prossima visita"
            on:input={(event) =>
              updatePianificazioneField(
                'motivoProssimaVisita',
                (event.currentTarget as HTMLInputElement).value
              )}
          />
        </div>
      </div>

      <div class="follow-up-field">
        <label for="esami_ematici_followup" class="follow-up-label">Esami ematici da fare</label>
        <textarea
          id="esami_ematici_followup"
          class="follow-up-textarea"
          rows="3"
          value={pianificazioneFollowUp.esamiEmaticiDaFare}
          on:input={(event) =>
            updatePianificazioneField(
              'esamiEmaticiDaFare',
              (event.currentTarget as HTMLTextAreaElement).value
            )}
        ></textarea>
      </div>
    </div>
  </div>
</Card>

<style>
  .section-title {
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--color-text);
    margin: 0 0 var(--space-3) 0;
    padding-bottom: var(--space-2);
    border-bottom: 2px solid var(--color-border);
  }

  .anamnesi-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .follow-up-section {
    margin-top: var(--space-4);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .follow-up-title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--color-text);
  }

  .follow-up-grid {
    display: grid;
    grid-template-columns: minmax(350px, 390px) minmax(180px, 1fr);
    gap: var(--space-3);
  }

  .follow-up-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .follow-up-label {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  .follow-up-input,
  .follow-up-textarea {
    width: 100%;
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--text-base);
    font-family: var(--font-sans);
    color: var(--color-text);
    background: var(--color-bg-primary);
    box-sizing: border-box;
    transition: all 0.2s;
  }

  .follow-up-datetime {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    justify-content: flex-start;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-primary);
    box-sizing: border-box;
    transition: all 0.2s;
  }

  .follow-up-segment-group {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }

  .follow-up-segment {
    width: 3.25rem;
    padding: var(--space-1) 0;
    border: none;
    background: transparent;
    font-size: var(--text-base);
    font-family: var(--font-sans);
    color: var(--color-text);
    text-align: center;
    outline: none;
  }

  .follow-up-segment-year {
    width: 4.5rem;
  }

  .follow-up-segment::placeholder {
    color: var(--color-text-tertiary);
    opacity: 1;
  }

  .follow-up-separator {
    color: var(--color-text-secondary);
    font-weight: 600;
    user-select: none;
  }

  .follow-up-datetime:focus-within,
  .follow-up-input:focus,
  .follow-up-textarea:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px rgba(30, 58, 138, 0.1);
  }

  .follow-up-textarea {
    min-height: 88px;
    resize: vertical;
    line-height: 1.5;
  }

  .follow-up-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }

  .follow-up-months-control {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 150px;
  }

  .follow-up-months-input-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .follow-up-months-select {
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 6px 44px 6px 10px;
    background: var(--color-bg-primary);
    color: var(--color-text);
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
  }

  .follow-up-months-select:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px rgba(30, 58, 138, 0.1);
  }

  .follow-up-action-btn {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 6px 10px;
    background: var(--color-bg-primary);
    color: var(--color-text);
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .follow-up-action-btn:hover:not(:disabled) {
    background: var(--color-bg-secondary);
    border-color: var(--color-text-tertiary);
  }

  .follow-up-action-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .follow-up-slots {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }

  .follow-up-slots-title {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .follow-up-slots-hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .follow-up-slots-error {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-error);
  }

  .follow-up-slots-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: var(--space-1);
  }

  .follow-up-slot-btn {
    border: 1px solid var(--color-border);
    background: var(--color-bg-primary);
    color: var(--color-text-secondary);
    border-radius: var(--radius-sm);
    padding: 4px 6px;
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    cursor: pointer;
    transition: all 0.2s;
  }

  .follow-up-slot-btn.available {
    color: var(--color-success);
    border-color: color-mix(in srgb, var(--color-success) 45%, transparent);
  }

  .follow-up-slot-btn.available:hover {
    background: color-mix(in srgb, var(--color-success) 12%, var(--color-bg-primary));
  }

  .follow-up-slot-btn.selected {
    background: color-mix(in srgb, var(--color-primary) 14%, var(--color-bg-primary));
    border-color: color-mix(in srgb, var(--color-primary) 60%, transparent);
    color: var(--color-primary);
    font-weight: 600;
  }

  .follow-up-slot-btn.occupied {
    color: var(--color-text-tertiary);
    background: var(--color-bg-secondary);
    opacity: 0.7;
    cursor: not-allowed;
  }

  @media (max-width: 768px) {
    .follow-up-grid {
      grid-template-columns: 1fr;
    }

    .follow-up-datetime {
      flex-direction: column;
      align-items: flex-start;
    }

    .follow-up-slots-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
</style>
