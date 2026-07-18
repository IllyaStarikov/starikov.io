import { describe, expect, it } from 'vitest';
import { mergeCounts } from '../scripts/lib/counts-integration.mjs';

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
});
