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

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_COUNTS_DIR = 'src/data/generated/counts';
const DEFAULT_OUT_FILE = 'src/data/generated/counts.json';

/**
 * Reads every `<collection>.json` file in `dir` and merges them into one
 * `{ [collection]: { count, slugs? } }` manifest object. PURE (given a
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
