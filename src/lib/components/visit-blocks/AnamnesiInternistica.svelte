<script lang="ts">
  import Card from '../Card.svelte';
  import SectionTitle from '../SectionTitle.svelte';
  import Textarea from '../Textarea.svelte';

  export let anamnesi_internistica = '';
</script>

<Card>
  <SectionTitle title="Anamnesi Internistica" />

  <Textarea
    id="anamnesi_internistica"
    bind:value={anamnesi_internistica}
    placeholder="Inserisci l'anamnesi internistica del paziente..."
    rows={6}
  />
</Card>
