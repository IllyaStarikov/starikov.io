import { describe, expect, it } from 'vitest';
import { wrapProseTables } from '../src/loaders/lib/prose-tables';

/*
 * wrapProseTables (v1.1 polish Task 8: named in the brief as an untested
 * "prose wrapper" gap). Shared by two loaders -- src/loaders/bin-tools.ts's
 * README sections and src/loaders/academia.ts's PORTFOLIO.md project bodies
 * (see global.css's `.prose-table-wrap` doc comment) -- both call Astro's
 * `renderMarkdown()` first and pass the resulting HTML straight through this,
 * so the function's own contract (per its JSDoc: regex over already-rendered
 * HTML, not a markdown or DOM parse) is exercised directly here with
 * hand-built HTML fragments, no real markdown render needed.
 */
describe('wrapProseTables', () => {
  it('wraps a single table in a .prose-table-wrap div, leaving the table itself untouched', () => {
    const html = '<p>intro</p><table><tr><th>A</th></tr><tr><td>1</td></tr></table><p>outro</p>';
    expect(wrapProseTables(html)).toBe(
      '<p>intro</p><div class="prose-table-wrap"><table><tr><th>A</th></tr><tr><td>1</td></tr></table></div><p>outro</p>',
    );
  });

  it('returns HTML with no <table> unchanged, byte for byte', () => {
    const html = '<h2>Usage</h2><p>Run it like this.</p><ul><li>one</li></ul>';
    expect(wrapProseTables(html)).toBe(html);
  });

  it('wraps two separate tables independently -- each gets its own wrapper, non-greedy across the gap between them', () => {
    const html = '<table><tr><td>first</td></tr></table><p>between</p><table><tr><td>second</td></tr></table>';
    const result = wrapProseTables(html);
    expect(result).toBe(
      '<div class="prose-table-wrap"><table><tr><td>first</td></tr></table></div>' +
        '<p>between</p>' +
        '<div class="prose-table-wrap"><table><tr><td>second</td></tr></table></div>',
    );
    // The non-greedy regex must not let one match swallow both tables plus
    // the paragraph between them into a single wrapper.
    expect(result.match(/prose-table-wrap/g)).toHaveLength(2);
  });

  it('preserves attributes on the <table> tag itself (Shiki/remark-gfm output carries none today, but the wrap must not assume that)', () => {
    const html = '<table class="foo" data-x="1"><tr><td>a</td></tr></table>';
    expect(wrapProseTables(html)).toBe(
      '<div class="prose-table-wrap"><table class="foo" data-x="1"><tr><td>a</td></tr></table></div>',
    );
  });

  it('preserves the exact inner content of the table, including nested markup, unmodified', () => {
    const html =
      '<table><thead><tr><th>Flag</th><th>Meaning</th></tr></thead>' +
      '<tbody><tr><td><code>--dry-run</code></td><td>Print, don’t act.</td></tr></tbody></table>';
    const result = wrapProseTables(html);
    expect(result.startsWith('<div class="prose-table-wrap">')).toBe(true);
    expect(result.endsWith('</div>')).toBe(true);
    expect(result).toContain('<code>--dry-run</code>');
    expect(result).toContain('Print, don’t act.');
  });

  it('is a no-op on an empty string', () => {
    expect(wrapProseTables('')).toBe('');
  });

  it('matches the README "How it works" endpoint-table shape verbatim (the live pocketcasts-reset case this was written against)', () => {
    const html =
      '<h2>How it works</h2>' +
      '<table>\n<tr><th>Step</th><th>Endpoint</th></tr>\n' +
      '<tr><td>Log in</td><td>/user/login</td></tr>\n</table>';
    const result = wrapProseTables(html);
    expect(result).toBe(
      '<h2>How it works</h2><div class="prose-table-wrap"><table>\n<tr><th>Step</th><th>Endpoint</th></tr>\n' +
        '<tr><td>Log in</td><td>/user/login</td></tr>\n</table></div>',
    );
  });
});
