<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Calendar } from '@fullcalendar/core';
  import type { CalendarOptions } from '@fullcalendar/core';

  export let options: CalendarOptions;

  let hostElement: HTMLDivElement | null = null;
  let calendar: Calendar | null = null;
  let mounted = false;
  let lastOptions: CalendarOptions | null = null;

  function initializeCalendar(nextOptions: CalendarOptions): void {
    if (!hostElement) {
      return;
    }

    if (calendar) {
      calendar.destroy();
    }

    calendar = new Calendar(hostElement, nextOptions);
    calendar.render();
    lastOptions = nextOptions;
  }

  onMount(() => {
    mounted = true;
    initializeCalendar(options);
  });

  onDestroy(() => {
    mounted = false;
    if (calendar) {
      calendar.destroy();
      calendar = null;
    }
  });

  $: if (mounted && options && options !== lastOptions) {
    initializeCalendar(options);
  }

  export function getAPI(): Calendar | null {
    return calendar;
  }
</script>

<div bind:this={hostElement}></div>
