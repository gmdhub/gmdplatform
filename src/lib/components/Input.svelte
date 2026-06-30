<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { capitalizeWords, uppercaseText } from '$lib/utils/formatters';
  import type { HTMLInputAttributes } from 'svelte/elements';
  import SegmentedDateField from './SegmentedDateField.svelte';

  export let type: 'text' | 'email' | 'password' | 'number' | 'date' | 'datetime-local' | 'tel' = 'text';
  export let value = '';
  export let placeholder = '';
  export let label = '';
  export let error = '';
  export let disabled = false;
  export let required = false;
  export let id = '';
  export let format: 'capitalize' | 'uppercase' | 'none' = 'none';
  export let step: string | number | undefined = undefined;
  export let inputmode: HTMLInputAttributes['inputmode'] = undefined;
  export let pattern: string | undefined = undefined;

  const dispatch = createEventDispatcher<{ input: string }>();

  function handleInput(event: Event) {
    // Salta la formattazione per i campi date per non interferire con il comportamento nativo
    if (type === 'date' || type === 'datetime-local') return;

    const target = event.target as HTMLInputElement;
    let newValue = target.value;

    if (format === 'capitalize') {
      newValue = capitalizeWords(newValue);
    } else if (format === 'uppercase') {
      newValue = uppercaseText(newValue);
    }

    value = newValue;
    target.value = newValue;
    dispatch('input', newValue);
  }
</script>

<div class="input-group">
  {#if label}
    <label for={id} class="label">
      {label}
      {#if required}<span class="required">*</span>{/if}
    </label>
  {/if}
  {#if type === 'date' || type === 'datetime-local'}
    <SegmentedDateField
      {id}
      bind:value
      withTime={type === 'datetime-local'}
      {disabled}
      {required}
      hasError={!!error}
      on:blur
      on:focus
    />
  {:else}
    <input
      {id}
      {type}
      {placeholder}
      {disabled}
      {required}
      {step}
      {inputmode}
      {pattern}
      bind:value
      class:error={!!error}
      on:input={handleInput}
      on:blur
      on:focus
    />
  {/if}
  {#if error}
    <span class="error-message">{error}</span>
  {/if}
</div>

<style>
  .input-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .label {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text);
  }

  .required {
    color: var(--color-error);
    margin-left: var(--space-1);
  }

  input {
    width: 100%;
    height: 34px;
    padding: var(--space-1) var(--space-4);
    font-size: var(--text-base);
    font-family: var(--font-sans);
    color: var(--color-text);
    background-color: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    transition: all var(--transition-fast);
    box-sizing: border-box;
    -webkit-box-sizing: border-box;
    -moz-box-sizing: border-box;
  }

  input:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px rgba(30, 58, 138, 0.1);
  }

  input:disabled {
    background-color: var(--color-bg-secondary);
    cursor: not-allowed;
    opacity: 0.6;
  }

  input.error {
    border-color: var(--color-error);
  }

  input.error:focus {
    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
  }

  .error-message {
    font-size: var(--text-sm);
    color: var(--color-error);
  }
</style>
