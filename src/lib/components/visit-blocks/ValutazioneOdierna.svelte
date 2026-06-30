<script lang="ts">
  import Card from '../Card.svelte';
  import SectionTitle from '../SectionTitle.svelte';
  import Textarea from '../Textarea.svelte';

  export let valutazione_odierna = '';
</script>

<Card>
  <SectionTitle title="Valutazione Odierna" />

  <Textarea
    id="valutazione_odierna"
    bind:value={valutazione_odierna}
    placeholder="Inserisci la valutazione odierna del paziente..."
    rows={6}
  />
</Card>
