<script lang="ts">
  import Card from '../Card.svelte';
  import SectionTitle from '../SectionTitle.svelte';
  import Textarea from '../Textarea.svelte';

  export let title: string;
  export let value = '';
  export let id: string;
  export let placeholder = '';
  export let rows = 6;
</script>

<Card>
  <SectionTitle {title} />

  <Textarea
    {id}
    bind:value
    {placeholder}
    {rows}
  />
</Card>
