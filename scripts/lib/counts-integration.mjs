// countsEmitter -- the Astro integration that turns the per-collection count
// files each loader writes (via src/loaders/lib/report.ts's `report.count()`)
// into ONE dist-independent manifest: src/data/generated/counts.json.
//
// WHY AN INTEGRATION, NOT A SHARED IN-MEMORY OBJECT: report.ts's module doc
// explains this in full, but the short version -- loaders run inside Astro's
// content-sync Vite SSR module runner; this integration is reached through
// astro.config.mjs's own (separately esbuild-bundled) config-loading graph.
// Those are two different instantiations of any shared module, so counts.json
// is assembled by reading files off disk at `astro:build:done`, not by
// importing report.ts's state directly.
//
// COUNTS_DIR (matching report.ts's own env override) lets a test point this
// at a scratch directory instead of the real repo path.
//
// clearCounts() (below, called by scripts/clear-counts.mjs -- the literal
// first step of `npm run build`'s chain) is the OTHER half of a Task 15
// code-review fix: a code reviewer reproduced a build where `.sources/bin`
// had been renamed away and the build re-run WITHOUT cleaning first. Because
// nothing wiped the previous build's COUNTS_DIR, bin-tools.ts's early return
// (source not found -> collection stays empty) never called report.count()
// at all, so the PREVIOUS build's tools.json ({count:1,
// slugs:['pocketcasts-reset']}) just sat there. countsEmitter's merge read it
// back as if it were fresh, and the min-counts gate silently PASSED
// (`tools=1 >= 1`) on a tool that no longer existed anywhere -- while the
// tools-HTML check failed with a misleadingly renderer-shaped message ("dist/
// bin/ is missing HTML for: pocketcasts-reset"). clearCounts() removes that
// whole class of bug by making a stale per-collection file structurally
// impossible: COUNTS_DIR (and any merged counts.json) is wiped before
// anything in the build can write to it again. bin-tools.ts's early-return
// path ALSO now calls report.count(..., 0, [], note) explicitly (report.ts),
// so the fix holds even if this cleanup step were ever skipped or reordered.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_COUNTS_DIR = 'src/data/generated/counts';
const DEFAULT_OUT_FILE = 'src/data/generated/counts.json';

function resolvedCountsDir() {
  return process.env.COUNTS_DIR ?? DEFAULT_COUNTS_DIR;
}

function resolvedOutFile() {
  return process.env.COUNTS_OUT_FILE ?? DEFAULT_OUT_FILE;
}

/**
 * Clears the counts-manifest staging directory (every per-collection JSON
 * `report.count()` previously wrote) and any merged counts.json left over
 * from a PREVIOUS build. A pure side effect (no return value) against
 * whichever `dir`/`outFile` are given -- both default to the real repo paths
 * (honoring the same COUNTS_DIR/COUNTS_OUT_FILE env overrides
 * `report.count()`/`countsEmitter()` use), so the real CLI entry point
 * (scripts/clear-counts.mjs) can call this with no arguments, while
 * test/counts-integration.test.mjs points it at an mkdtempSync scratch root
 * to prove a stale file cannot survive the call. Safe to call when nothing
 * exists yet (a fresh clone, or the very first build).
 */
export function clearCounts({ dir = resolvedCountsDir(), outFile = resolvedOutFile() } = {}) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  rmSync(outFile, { force: true });
}

/**
 * Reads every `<collection>.json` file in `dir` and merges them into one
 * `{ [collection]: { count, slugs?, note? } }` manifest object. PURE (given a
 * pre-read file list + contents) -- exported so the merge shape is unit
 * tested without touching a real Astro build.
 */
export function mergeCounts(files) {
  const manifest = {};
  for (const { name, contents } of files) {
    if (!name.endsWith('.json')) continue;
    const collection = name.slice(0, -'.json'.length);
    manifest[collection] = JSON.parse(contents);
  }
  return manifest;
}

/** Reads COUNTS_DIR off disk into the `{name, contents}[]` shape mergeCounts wants. */
function readCountsDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({ name, contents: readFileSync(join(dir, name), 'utf8') }));
}

export function countsEmitter() {
  return {
    name: 'counts-emitter',
    hooks: {
      'astro:build:done': async () => {
        const dir = process.env.COUNTS_DIR ?? DEFAULT_COUNTS_DIR;
        const outFile = process.env.COUNTS_OUT_FILE ?? DEFAULT_OUT_FILE;
        const manifest = mergeCounts(readCountsDir(dir));

        mkdirSync(dirname(outFile), { recursive: true });
        writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`);
        console.log(
          `counts: wrote ${Object.keys(manifest).length} collection count(s) to ${outFile}`,
        );
      },
    },
  };
}
