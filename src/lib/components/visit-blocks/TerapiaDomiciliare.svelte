<script lang="ts">
  import Card from '../Card.svelte';
  import SectionTitle from '../SectionTitle.svelte';
  import Textarea from '../Textarea.svelte';

  export let terapia_domiciliare = '';
</script>

<Card>
  <SectionTitle title="Terapia domiciliare" />

  <Textarea
    id="terapia_domiciliare"
    bind:value={terapia_domiciliare}
    placeholder="Inserisci la terapia domiciliare..."
    rows={6}
  />
</Card>
