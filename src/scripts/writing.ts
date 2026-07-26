/*
 * /writing client runtime: the tag filter chips. Progressive enhancement over
 * correct server output (zero islands, vanilla only, same contract as
 * academia.ts / project-media.ts / tool.ts) -- every essay row renders visible
 * with no JS; this only adds the click-to-filter behavior.
 *
 * `hidden` attribute toggling only (design spec: "no layout thrash") -- never
 * a display/opacity animation, never removing rows from the DOM. A year
 * section whose rows are ALL hidden hides too, so filtering never leaves an
 * orphan year heading over an empty list.
 *
 * Rows are selected as `.ledger-row` directly (Task 2, v1.1 polish): a
 * dedicated `[data-writing-row]` marker used to live on a wrapper div around
 * each row, but that wrapper is gone (byte diet) and `data-tags` now lives on
 * the LedgerRow anchor itself. `.ledger-row` alone is precise enough here --
 * this module only ever runs on /writing, so every match IS an essay row.
 * `.ledger-row[hidden]{display:none}` (LedgerRow.astro's global style) is
 * what makes setting `.hidden` here actually take effect against the row's
 * own `display:flex`.
 *
 * Re-initialised on every astro:page-load; per-chip `dataset.wired` guards
 * against double-binding if init() ever runs twice for the same DOM.
 */

export {};

function applyFilter(tag: string): void {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.ledger-row'));
  for (const row of rows) {
    const tags = (row.dataset.tags ?? '').split(',').filter(Boolean);
    row.hidden = tag !== 'all' && !tags.includes(tag);
  }

  const groups = Array.from(document.querySelectorAll<HTMLElement>('[data-year-group]'));
  for (const group of groups) {
    const groupRows = Array.from(group.querySelectorAll<HTMLElement>('.ledger-row'));
    group.hidden = groupRows.length > 0 && groupRows.every((row) => row.hidden);
  }
}

function wireChips(): void {
  const chips = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tag-filter]'));
  if (chips.length === 0) return;

  chips.forEach((chip) => {
    if (chip.dataset.wired) return;
    chip.dataset.wired = '1';
    chip.addEventListener('click', () => {
      const tag = chip.dataset.tagFilter ?? 'all';
      chips.forEach((c) => c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'));
      applyFilter(tag);
    });
  });
}

function init(): void {
  wireChips();
}

init();
document.addEventListener('astro:page-load', init);
