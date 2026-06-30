<script lang="ts">
  import { onMount } from 'svelte';

  export let id: string;
  export let value = '';
  export let placeholder = '';
  export let rows = 5;
  export let preserveNewlines = false;

  let contentEditableDiv: HTMLDivElement;
  let isUpdating = false;

  // Converti Markdown in HTML
  function markdownToHtml(markdown: string): string {
    let html = markdown;

    // Grassetto: **text** -> <strong>text</strong>
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Corsivo: *text* -> <em>text</em> (solo se non è già parte di **)
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

    // Sottolineato: __text__ -> <u>text</u>
    html = html.replace(/__(.+?)__/g, '<u>$1</u>');

    // Converti newline in <br>
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  // Converti HTML in Markdown
  function htmlToMarkdown(html: string): string {
    let markdown = html;

    // Converti <br> in newline
    markdown = markdown.replace(/<br\s*\/?>/gi, '\n');

    // Converti blocchi HTML aggiunti dai diversi browser/WebView in newline.
    markdown = markdown.replace(/<\/(div|p|li|h[1-6])>\s*<(div|p|li|h[1-6])[^>]*>/gi, '\n');
    markdown = markdown.replace(/<(div|p|li|h[1-6])[^>]*>/gi, '');
    markdown = markdown.replace(/<\/(div|p|li|h[1-6])>/gi, '\n');

    // Grassetto: <strong>text</strong> -> **text**
    markdown = markdown.replace(/<strong>(.+?)<\/strong>/g, '**$1**');
    markdown = markdown.replace(/<b>(.+?)<\/b>/g, '**$1**');

    // Corsivo: <em>text</em> -> *text*
    markdown = markdown.replace(/<em>(.+?)<\/em>/g, '*$1*');
    markdown = markdown.replace(/<i>(.+?)<\/i>/g, '*$1*');

    // Sottolineato: <u>text</u> -> __text__
    markdown = markdown.replace(/<u>(.+?)<\/u>/g, '__$1__');

    // Rimuovi eventuali tag HTML rimanenti
    markdown = markdown.replace(/<[^>]+>/g, '');

    markdown = markdown.replace(/&nbsp;/g, ' ');

    // Nei campi multilinea semplici, i newline finali sono necessari: premere
    // Invio a fine riga deve restare visibile e diventare la riga successiva.
    markdown = preserveNewlines
      ? markdown.replace(/^\n+/, '')
      : markdown.replace(/^\n+|\n+$/g, '');

    return markdown;
  }

  // Aggiorna il contenuto del div quando il value cambia
  $: if (contentEditableDiv && !isUpdating) {
    const html = markdownToHtml(value);
    if (contentEditableDiv.innerHTML !== html) {
      // Salva la posizione del cursore
      const selection = window.getSelection();
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      const cursorOffset = range ? range.startOffset : 0;
      const cursorNode = range ? range.startContainer : null;

      contentEditableDiv.innerHTML = html;

      // Ripristina il cursore se possibile
      if (cursorNode && contentEditableDiv.contains(cursorNode)) {
        try {
          const newRange = document.createRange();
          newRange.setStart(cursorNode, Math.min(cursorOffset, cursorNode.textContent?.length || 0));
          newRange.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(newRange);
        } catch (e) {
          // Ignora errori di posizionamento cursore
        }
      }
    }
  }

  function insertLineBreakAtSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();

    const lineBreak = document.createElement('br');
    range.insertNode(lineBreak);
    range.setStartAfter(lineBreak);
    range.collapse(true);

    selection.removeAllRanges();
    selection.addRange(range);
    handleInput();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (
      event.defaultPrevented ||
      !preserveNewlines ||
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    insertLineBreakAtSelection();
  }

  // Gestisci input dell'utente
  function handleInput() {
    if (contentEditableDiv) {
      isUpdating = true;
      const html = contentEditableDiv.innerHTML;
      value = htmlToMarkdown(html);
      isUpdating = false;
    }
  }

  // Gestisci paste per rimuovere formattazione esterna
  function handlePaste(event: ClipboardEvent) {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') || '';

    // Inserisci il testo senza formattazione
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    handleInput();
  }

  export function getElement(): HTMLDivElement {
    return contentEditableDiv;
  }

  onMount(() => {
    if (contentEditableDiv) {
      contentEditableDiv.innerHTML = markdownToHtml(value);
    }
  });
</script>

<div class="rich-textarea-wrapper">
  <div
    bind:this={contentEditableDiv}
    {id}
    contenteditable="true"
    role="textbox"
    tabindex="0"
    aria-multiline="true"
    class="rich-textarea"
    style="min-height: {rows * 1.5}em;"
    on:input={handleInput}
    on:paste={handlePaste}
    on:blur
    on:focus
    on:keydown
    on:keydown={handleKeydown}
    data-placeholder={placeholder}
  ></div>
</div>

<style>
  .rich-textarea-wrapper {
    position: relative;
    width: 100%;
  }

  .rich-textarea {
    width: 100%;
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-family: inherit;
    font-size: var(--text-base);
    line-height: 1.5;
    color: var(--color-text);
    background: var(--color-bg-primary);
    transition: all 0.2s;
    overflow-y: auto;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .rich-textarea:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  .rich-textarea:empty:before {
    content: attr(data-placeholder);
    color: var(--color-text-secondary);
    opacity: 0.6;
  }

  /* Stili per il testo formattato */
  .rich-textarea :global(strong) {
    font-weight: 700;
  }

  .rich-textarea :global(em) {
    font-style: italic;
  }

  .rich-textarea :global(u) {
    text-decoration: underline;
  }
</style>
