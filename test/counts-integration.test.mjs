import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearCounts, mergeCounts } from '../scripts/lib/counts-integration.mjs';

// countsEmitter() itself is an Astro integration hook (astro:build:done) --
// only exercised by a real `astro build` (see task-15-report.md for why:
// it and the content-layer loaders that write the per-collection files it
// reads run in two different module-loading contexts, so there's nothing
// meaningful to unit-test about the hook wiring itself). mergeCounts() is
// the one piece of real logic in the module, and it's pure: given the
// {name, contents}[] shape readCountsDir() produces, no real filesystem
// required.
describe('mergeCounts', () => {
  it('merges every file into one object keyed by collection name (".json" stripped)', () => {
    const manifest = mergeCounts([
      { name: 'tools.json', contents: '{"count":1,"slugs":["pocketcasts-reset"]}' },
      { name: 'essays.json', contents: '{"count":94}' },
    ]);
    expect(manifest).toEqual({
      tools: { count: 1, slugs: ['pocketcasts-reset'] },
      essays: { count: 94 },
    });
  });

  it('is [] -> {} for no files', () => {
    expect(mergeCounts([])).toEqual({});
  });

  it('ignores a non-.json file defensively (COUNTS_DIR should never have one, but stay strict)', () => {
    expect(mergeCounts([{ name: 'README.md', contents: 'not json' }])).toEqual({});
  });

  it('last file for a given collection name wins (mirrors report.count()\'s overwrite-per-call contract)', () => {
    const manifest = mergeCounts([
      { name: 'tools.json', contents: '{"count":1}' },
      { name: 'tools.json', contents: '{"count":2}' },
    ]);
    expect(manifest).toEqual({ tools: { count: 2 } });
  });

  it('passes a note through untouched (validate-dist reads it back for the root-cause hint)', () => {
    const manifest = mergeCounts([
      {
        name: 'tools.json',
        contents: JSON.stringify({ count: 0, slugs: [], note: 'source checkout not found at .sources/bin' }),
      },
    ]);
    expect(manifest).toEqual({
      tools: { count: 0, slugs: [], note: 'source checkout not found at .sources/bin' },
    });
  });
});

/*
 * clearCounts() -- the Task 15 code-review fix. A reviewer reproduced a
 * build where `.sources/bin` had been renamed away and the build re-run
 * WITHOUT cleaning first: bin-tools.ts's early-return path never called
 * report.count() at all (before this fix), so the PREVIOUS build's
 * tools.json ({count:1, slugs:['pocketcasts-reset']}) just sat in COUNTS_DIR.
 * countsEmitter's merge read it back as fresh, and the min-counts gate
 * silently PASSED on a tool that no longer existed. clearCounts() (called by
 * scripts/clear-counts.mjs, the literal first step of `npm run build`) makes
 * that impossible by wiping COUNTS_DIR + the merged counts.json before
 * anything in the build can write to them again.
 */
describe('clearCounts', () => {
  let scratch;

  afterEach(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
  });

  it('removes every stale per-collection file already in the counts dir', () => {
    scratch = mkdtempSync(join(tmpdir(), 'clear-counts-'));
    const dir = join(scratch, 'counts');
    const outFile = join(scratch, 'counts.json');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'tools.json'), JSON.stringify({ count: 1, slugs: ['pocketcasts-reset'] }));
    writeFileSync(join(dir, 'essays.json'), JSON.stringify({ count: 94 }));
    writeFileSync(outFile, JSON.stringify({ tools: { count: 1 }, essays: { count: 94 } }));

    clearCounts({ dir, outFile });

    expect(existsSync(dir)).toBe(true); // recreated, not just deleted
    expect(readdirSync(dir)).toEqual([]);
    expect(existsSync(outFile)).toBe(false);
  });

  it('is safe to call against paths that do not exist yet (a fresh clone, or the very first build)', () => {
    scratch = mkdtempSync(join(tmpdir(), 'clear-counts-fresh-'));
    const dir = join(scratch, 'nested', 'counts');
    const outFile = join(scratch, 'nested', 'counts.json');

    expect(() => clearCounts({ dir, outFile })).not.toThrow();
    expect(existsSync(dir)).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  it(
    "reproduces the reviewer's scenario end to end and proves it is now impossible: " +
      'a stale tools.json cannot survive into the next build\'s merge',
    () => {
      scratch = mkdtempSync(join(tmpdir(), 'clear-counts-repro-'));
      const dir = join(scratch, 'counts');
      const outFile = join(scratch, 'counts.json');

      // Build N: .sources/bin existed, one real tool loaded.
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'tools.json'), JSON.stringify({ count: 1, slugs: ['pocketcasts-reset'] }));
      writeFileSync(outFile, JSON.stringify({ tools: { count: 1, slugs: ['pocketcasts-reset'] } }));

      // Build N+1: .sources/bin renamed away, build re-run. FIRST, the build
      // chain's new first step runs (this is the fix under test)...
      clearCounts({ dir, outFile });
      // ...THEN bin-tools.ts's early-return path writes an explicit zero
      // (the second, independent layer of defense -- see report.ts).
      writeFileSync(
        join(dir, 'tools.json'),
        JSON.stringify({ count: 0, slugs: [], note: 'source checkout not found at .sources/bin' }),
      );

      const manifest = mergeCounts(
        readdirSync(dir).map((name) => ({ name, contents: readFileSync(join(dir, name), 'utf8') })),
      );

      // The stale count:1/pocketcasts-reset is GONE -- the merge reflects
      // build N+1's reality (zero tools, with a note explaining why), never
      // build N's leftover data.
      expect(manifest.tools).toEqual({
        count: 0,
        slugs: [],
        note: 'source checkout not found at .sources/bin',
      });
    },
  );
});
