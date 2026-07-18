import { describe, expect, it } from 'vitest';
import {
  occurrences,
  compareSlugs,
  withNote,
  toolsCheckRow,
  anyContains,
  pagefindEnabled,
  isDraftFrontmatter,
  cnameMatchesOrigin,
  checkMinCounts,
  formatSummaryTable,
  annotationLine,
  checkUrls,
} from '../scripts/validate-dist.mjs';

// scripts/validate-dist.mjs's main() shells out to the real filesystem (dist/,
// counts.json, themes.json) and -- under BUILD_STRICT -- the network (the
// academia HEAD checks). None of that runs here: only the PURE decision
// functions main() is built from are exercised, each fed plain data, exactly
// like transcode-media.test.mjs does for needsTranscode(). No network, no
// real dist/ required.

describe('occurrences (essay-link count in /writing/)', () => {
  it('counts non-overlapping substring occurrences', () => {
    expect(occurrences('a starikov.co/1 b starikov.co/2', 'starikov.co/')).toBe(2);
  });

  it('is 0 for no matches', () => {
    expect(occurrences('nothing here', 'starikov.co/')).toBe(0);
  });

  it('is 0 for an empty haystack', () => {
    expect(occurrences('', 'starikov.co/')).toBe(0);
  });
});

describe('compareSlugs (tools: counts.json slugs vs dist/bin/*/ dirs)', () => {
  it('reports no diff when both sides match, regardless of input order', () => {
    expect(compareSlugs(['b', 'a'], ['a', 'b'])).toEqual({ missing: [], extra: [] });
  });

  it('reports a slug present in counts.json but missing from dist as "missing"', () => {
    expect(compareSlugs(['a', 'b'], ['a'])).toEqual({ missing: ['b'], extra: [] });
  });

  it('reports a slug present in dist but not in counts.json as "extra"', () => {
    expect(compareSlugs(['a'], ['a', 'ghost-page'])).toEqual({ missing: [], extra: ['ghost-page'] });
  });

  it('handles both empty', () => {
    expect(compareSlugs([], [])).toEqual({ missing: [], extra: [] });
  });
});

describe('withNote (root-cause hint formatting)', () => {
  it('returns the text unchanged when there is no note', () => {
    expect(withNote('0 < 1', undefined)).toBe('0 < 1');
  });

  it('appends the note in parens when given', () => {
    expect(withNote('0 < 1', 'source checkout not found at .sources/bin')).toBe(
      '0 < 1 (source checkout not found at .sources/bin)',
    );
  });
});

/*
 * toolsCheckRow -- Task 15 code-review fix. A reviewer reproduced a build
 * where `.sources/bin` had been renamed away and the build re-run WITHOUT
 * cleaning first: a stale tools.json (count:1, slugs:['pocketcasts-reset'])
 * from a PREVIOUS build survived, and the resulting "tools HTML" row read
 * "dist/bin/ is missing HTML for: pocketcasts-reset" -- which reads exactly
 * like a rendering defect (a page failed to generate), not the real root
 * cause (the source checkout is gone). These tests prove the fix: once a
 * loader's early-return path writes an explicit `{count:0, slugs:[],
 * note:'...'}` (report.ts's report.count(..., note)) instead of leaving the
 * stale file in place (scripts/lib/counts-integration.mjs's clearCounts()
 * closes that separately), the row's own text names the root cause.
 */
describe('toolsCheckRow (misleading-message fix: root-cause note surfaces in the row text)', () => {
  it('passes trivially (0/0) when both counts.json and dist/bin/ agree there are no tools, and still surfaces the note', () => {
    const row = toolsCheckRow({ count: 0, slugs: [], note: 'source checkout not found at .sources/bin' }, []);
    expect(row.status).toBe('pass');
    expect(row.detail).toBe('0/0 slugs present in dist/bin/ (source checkout not found at .sources/bin)');
  });

  it('fails and names a genuinely missing page when there is no note (the ordinary case)', () => {
    const row = toolsCheckRow({ count: 1, slugs: ['pocketcasts-reset'] }, []);
    expect(row.status).toBe('fail');
    expect(row.detail).toBe(
      'dist/bin/ is missing HTML for: pocketcasts-reset (counts.json lists 1 tool(s))',
    );
  });

  it("reproduces the reviewer's exact scenario: BEFORE the fix (stale entry, no note) the message is misleading; AFTER (explicit zero + note) it names the root cause", () => {
    // Before: a stale, unrelated entry from a previous build survives (what
    // clearCounts()/report.count()'s explicit-zero calls now prevent) --
    // the row blames "missing HTML", indistinguishable from a renderer bug.
    const staleRow = toolsCheckRow({ count: 1, slugs: ['pocketcasts-reset'] }, []);
    expect(staleRow.status).toBe('fail');
    expect(staleRow.detail).not.toMatch(/checkout|source not found/);

    // After: bin-tools.ts's missing-root path calls
    // report.count('tools', 0, [], 'source checkout not found at .sources/bin')
    // -- the row now says exactly why there's nothing to check.
    const fixedRow = toolsCheckRow(
      { count: 0, slugs: [], note: 'source checkout not found at .sources/bin' },
      [],
    );
    expect(fixedRow.detail).toContain('source checkout not found at .sources/bin');
  });

  it('treats a missing counts.json entry entirely the same as an explicit zero (no note, 0 expected)', () => {
    const row = toolsCheckRow(undefined, []);
    expect(row).toEqual({ status: 'pass', detail: '0/0 slugs present in dist/bin/', extra: [] });
  });

  it('surfaces unexpected extra dist/bin/ pages via the returned `extra` list', () => {
    const row = toolsCheckRow({ count: 1, slugs: ['pocketcasts-reset'] }, ['pocketcasts-reset', 'ghost-page']);
    expect(row.status).toBe('pass');
    expect(row.extra).toEqual(['ghost-page']);
  });
});

describe('anyContains (theme CSS sentinel grep)', () => {
  it('true when the sentinel appears in any one of several css sources', () => {
    expect(anyContains(['a{}', '[data-theme="x"]{--code-comment:#000;}'], '--code-comment')).toBe(true);
  });

  it('false when no source contains it', () => {
    expect(anyContains(['a{}', 'b{}'], '--code-comment')).toBe(false);
  });

  it('false for an empty list', () => {
    expect(anyContains([], '--code-comment')).toBe(false);
  });
});

describe('pagefindEnabled (Task 16 feature flag)', () => {
  it('false today: astro.config.mjs has no pagefind integration yet', () => {
    const src = `import mdx from '@astrojs/mdx';\nexport default defineConfig({ integrations: [mdx()] });\n`;
    expect(pagefindEnabled(src)).toBe(false);
  });

  it('true once astro.config.mjs mentions pagefind, case-insensitively', () => {
    expect(pagefindEnabled(`import pagefind from 'astro-pagefind';`)).toBe(true);
    expect(pagefindEnabled(`// PAGEFIND enabled`)).toBe(true);
  });
});

describe('isDraftFrontmatter (projects min-count: glob minus draft:true)', () => {
  it('false when there is no draft field', () => {
    const mdx = '---\ntitle: Dotfiles\nfeatured: true\n---\n\n## Story\n';
    expect(isDraftFrontmatter(mdx)).toBe(false);
  });

  it('true when draft: true is set', () => {
    const mdx = '---\ntitle: WIP\ndraft: true\n---\n\nnope\n';
    expect(isDraftFrontmatter(mdx)).toBe(true);
  });

  it('false when draft: false is set explicitly', () => {
    const mdx = '---\ntitle: Shipped\ndraft: false\n---\n\nyep\n';
    expect(isDraftFrontmatter(mdx)).toBe(false);
  });

  it('false when there is no frontmatter block at all', () => {
    expect(isDraftFrontmatter('# just a heading\n')).toBe(false);
  });
});

describe('cnameMatchesOrigin (dist/CNAME sanity, not just existence)', () => {
  it('true when the file content is exactly the origin hostname', () => {
    expect(cnameMatchesOrigin('starikov.io\n', 'https://starikov.io')).toBe(true);
  });

  it('false for a stale/wrong hostname', () => {
    expect(cnameMatchesOrigin('example.com\n', 'https://starikov.io')).toBe(false);
  });

  it('false for empty content', () => {
    expect(cnameMatchesOrigin('', 'https://starikov.io')).toBe(false);
  });
});

describe('checkMinCounts -- the hard gate, and its exact gate-proof shape', () => {
  it('returns no failures when every actual meets its minimum', () => {
    const actual = { essays: 94, tools: 1, themeVariants: 38, projects: 6 };
    const min = { essays: 50, tools: 1, themeVariants: 10, projects: 4 };
    expect(checkMinCounts(actual, min)).toEqual([]);
  });

  it('reproduces the brief\'s literal gate-proof: essays 94 < 99999', () => {
    const actual = { essays: 94, tools: 1, themeVariants: 38, projects: 6 };
    const min = { essays: 99999, tools: 1, themeVariants: 10, projects: 4 };
    expect(checkMinCounts(actual, min)).toEqual([{ key: 'essays', actual: 94, min: 99999 }]);
  });

  it('reports every failing key, sorted, when several are under', () => {
    const actual = { essays: 10, tools: 0, themeVariants: 38, projects: 6 };
    const min = { essays: 50, tools: 1, themeVariants: 10, projects: 4 };
    expect(checkMinCounts(actual, min)).toEqual([
      { key: 'essays', actual: 10, min: 50 },
      { key: 'tools', actual: 0, min: 1 },
    ]);
  });

  it('treats a missing actual as 0', () => {
    expect(checkMinCounts({}, { tools: 1 })).toEqual([{ key: 'tools', actual: 0, min: 1 }]);
  });

  it('omits the note field entirely when none is given -- exact match to the brief\'s gate-proof shape', () => {
    // Guards against a regression that would add `note: undefined` (which
    // toEqual would still pass on, but a real JSON.stringify would render
    // as a literal "note":null/undefined) to every failure by default.
    const result = checkMinCounts({ essays: 94 }, { essays: 99999 });
    expect(result).toEqual([{ key: 'essays', actual: 94, min: 99999 }]);
    expect(Object.hasOwn(result[0], 'note')).toBe(false);
  });

  it('folds a provenance note onto its matching failing key only', () => {
    const actual = { essays: 94, tools: 0 };
    const min = { essays: 50, tools: 1 };
    const notes = { tools: 'source checkout not found at .sources/bin' };
    expect(checkMinCounts(actual, min, notes)).toEqual([
      { key: 'tools', actual: 0, min: 1, note: 'source checkout not found at .sources/bin' },
    ]);
  });

  it('ignores a note for a key that is not actually failing', () => {
    const actual = { essays: 94, tools: 1 };
    const min = { essays: 50, tools: 1 };
    const notes = { tools: 'irrelevant -- tools did not fail' };
    expect(checkMinCounts(actual, min, notes)).toEqual([]);
  });
});

describe('annotationLine (GH-annotation formatting, independent of report.ts\'s GITHUB_ACTIONS gate)', () => {
  it('plain text when annotations are off', () => {
    expect(annotationLine(false, 'error', 'essays', '94 < 99999')).toBe('essays: ERROR: 94 < 99999');
  });

  it('::error:: format when annotations are on (real CI OR local BUILD_STRICT dry run)', () => {
    expect(annotationLine(true, 'error', 'essays', '94 < 99999')).toBe('::error::essays: 94 < 99999');
  });

  it('::warning:: format for warn level', () => {
    expect(annotationLine(true, 'warning', 'pagefind', 'not enabled yet; skipping')).toBe(
      '::warning::pagefind: not enabled yet; skipping',
    );
  });
});

describe('formatSummaryTable', () => {
  it('renders a markdown table with one row per check', () => {
    const table = formatSummaryTable([
      { name: 'tools HTML', status: 'pass', detail: '1/1 slugs present' },
      { name: 'essays min-count', status: 'fail', detail: '94 < 99999' },
    ]);
    expect(table).toContain('| Check | Status | Detail |');
    expect(table).toContain('| tools HTML | pass | 1/1 slugs present |');
    expect(table).toContain('| essays min-count | fail | 94 < 99999 |');
  });

  it('renders a header-only table for an empty check list', () => {
    const table = formatSummaryTable([]);
    expect(table).toContain('| Check | Status | Detail |');
    expect(table.trim().split('\n')).toHaveLength(2);
  });
});

describe('checkUrls (academia PDF HEAD checks -- injected fn, never real network)', () => {
  it('reports ok:true for every URL the injected head function resolves 200 for', async () => {
    const head = async () => ({ ok: true, status: 200 });
    const results = await checkUrls(['https://academia.starikov.io/curated.pdf'], head);
    expect(results).toEqual([{ url: 'https://academia.starikov.io/curated.pdf', ok: true, status: 200 }]);
  });

  it('reports ok:false with the status for a non-200 response', async () => {
    const head = async () => ({ ok: false, status: 404 });
    const results = await checkUrls(['https://academia.starikov.io/missing.pdf'], head);
    expect(results).toEqual([{ url: 'https://academia.starikov.io/missing.pdf', ok: false, status: 404 }]);
  });

  it('reports ok:false with the error message when the injected fn throws (network down)', async () => {
    const head = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    const results = await checkUrls(['https://academia.starikov.io/curated.pdf'], head);
    expect(results).toEqual([
      { url: 'https://academia.starikov.io/curated.pdf', ok: false, error: 'getaddrinfo ENOTFOUND' },
    ]);
  });

  it('checks every URL independently -- one failure does not short-circuit the rest', async () => {
    const head = async (url) => (url.includes('bad') ? { ok: false, status: 500 } : { ok: true, status: 200 });
    const results = await checkUrls(['https://x/good.pdf', 'https://x/bad.pdf'], head);
    expect(results.map((r) => r.ok)).toEqual([true, false]);
  });
});
