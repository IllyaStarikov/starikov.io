/*
 * Shared HTML post-processor for content loaders whose rendered markdown
 * lands inside a `.prose` container via `set:html` (the bin-tools loader's
 * README sections and the academia loader's PORTFOLIO.md project bodies --
 * both call Astro's own `renderMarkdown()` at load time, then this). A
 * README or PORTFOLIO.md table isn't guaranteed to fit the page's ~70ch
 * reading column, so every rendered table gets an overflow-x scroller
 * (global.css: `.prose-table-wrap`) regardless of which loader produced it.
 */

/**
 * Wraps every `<table>...</table>` in rendered markdown HTML with a
 * `.prose-table-wrap` div (global.css: `overflow-x: auto` + a themed
 * scrollbar) -- the pocketcasts-reset "How it works" table is the live
 * example this was written against (browser-default, unstyled, and wider
 * than its column with no way to scroll before this).
 *
 * A CSS-only fix (`table { display: block; overflow-x: auto }`) was
 * considered and rejected: it strips the table's row/column semantics from
 * assistive tech. A wrapper div preserves the real `<table>` completely
 * while still giving a too-wide table somewhere to scroll besides the whole
 * page. Regex, not a DOM parse: the input is Astro's own Shiki/remark-gfm
 * output (deterministic, no nested tables in a README/PORTFOLIO's flat
 * sections), so a non-greedy match per `<table>...</table>` is exact and
 * avoids a real HTML-parsing dependency for one wrapper div.
 */
export function wrapProseTables(html: string): string {
  return html.replace(/<table\b[^>]*>[\s\S]*?<\/table>/g, (table) => `<div class="prose-table-wrap">${table}</div>`);
}
