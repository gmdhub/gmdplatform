<script lang="ts">
  import Card from '../Card.svelte';
  import Textarea from '../Textarea.svelte';

  export let title: string;
  export let value = '';
  export let id: string;
  export let placeholder = '';
  export let rows = 6;
</script>

<Card>
  <h2 class="section-title">{title}</h2>

  <Textarea
    {id}
    bind:value
    {placeholder}
    {rows}
  />
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
</style>
