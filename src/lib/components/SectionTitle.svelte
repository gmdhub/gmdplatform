<script lang="ts">
  export let title: string;
</script>

<div class="section-title">
  <h2>{title}</h2>
  <slot />
</div>

<style>
  .section-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin: 0 0 var(--space-4) 0;
    padding-bottom: var(--space-3);
    border-bottom: 2px solid var(--color-border);
  }

  h2 {
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--color-text-primary);
    margin: 0;
  }

  @media (max-width: 640px) {
    .section-title {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
