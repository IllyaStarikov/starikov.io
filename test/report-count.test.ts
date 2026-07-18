import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { report } from '../src/loaders/lib/report';

/*
 * report.count() writes one small JSON file per collection under COUNTS_DIR
 * rather than accumulating in-memory module state like warn()/error() do --
 * see report.ts's module doc for why (an astro:build:done integration hook
 * and a content-layer loader are two different module instantiations of
 * "the same" file, so in-memory state doesn't cross that boundary; disk +
 * an env var for the path does). This is the direct, disk-level test of that
 * contract; scripts/lib/counts-integration.mjs's mergeCounts() (tested in
 * test/counts-integration.test.mjs) is the other half -- reading those files
 * back into one manifest.
 */
describe('report.count()', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'report-count-'));
    process.env.COUNTS_DIR = dir;
  });

  afterAll(() => {
    delete process.env.COUNTS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    report.flush();
  });

  it('writes {count} to <COUNTS_DIR>/<collection>.json when no slugs are given', () => {
    report.count('essays', 94);
    const written = JSON.parse(readFileSync(join(dir, 'essays.json'), 'utf8'));
    expect(written).toEqual({ count: 94 });
  });

  it('writes {count, slugs} when slugs are given', () => {
    report.count('tools', 1, ['pocketcasts-reset']);
    const written = JSON.parse(readFileSync(join(dir, 'tools.json'), 'utf8'));
    expect(written).toEqual({ count: 1, slugs: ['pocketcasts-reset'] });
  });

  it('a later call for the same collection overwrites the earlier one', () => {
    report.count('repos', 3);
    report.count('repos', 9);
    const written = JSON.parse(readFileSync(join(dir, 'repos.json'), 'utf8'));
    expect(written).toEqual({ count: 9 });
  });

  it('does not touch warnings/errors -- flush() is unaffected by count() calls', () => {
    report.count('essays', 94);
    expect(report.flush()).toEqual({ warnings: 0, errors: 0 });
  });

  // Task 15 code-review fix: every loader early-return/catch path now calls
  // count() with an explicit 0 and a provenance note, so a source's absence
  // is always distinguishable from "the source loaded fine but is empty".
  it('writes {count, slugs, note} when a note is given alongside slugs (bin-tools.ts\'s missing-root path)', () => {
    report.count('tools', 0, [], 'source checkout not found at .sources/bin');
    const written = JSON.parse(readFileSync(join(dir, 'tools.json'), 'utf8'));
    expect(written).toEqual({ count: 0, slugs: [], note: 'source checkout not found at .sources/bin' });
  });

  it('writes {count, note} (no slugs key) when a note is given without slugs (academia/ghost\'s early-return paths)', () => {
    report.count('essays', 0, undefined, 'Ghost snapshot unavailable: offline');
    const written = JSON.parse(readFileSync(join(dir, 'essays.json'), 'utf8'));
    expect(written).toEqual({ count: 0, note: 'Ghost snapshot unavailable: offline' });
  });

  it('omits the note field entirely when none is given (no "note": null/undefined leaking into counts.json)', () => {
    report.count('courses', 34);
    const written = JSON.parse(readFileSync(join(dir, 'courses.json'), 'utf8'));
    expect(Object.hasOwn(written, 'note')).toBe(false);
  });
});
