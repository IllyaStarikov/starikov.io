#!/usr/bin/env node
/*
 * clear-counts.mjs -- the tiny FIRST step of `npm run build`'s chain (see
 * package.json). Owns clearing the build's counts-manifest staging area
 * (COUNTS_DIR, default src/data/generated/counts/) and any merged
 * src/data/generated/counts.json left over from a PREVIOUS build, so a
 * loader's early-return/catch path in THIS build can never accidentally
 * inherit a stale per-collection count file from a run where that source
 * checkout existed.
 *
 * Task 15 code-review finding: without this, renaming `.sources/bin` away
 * and rebuilding without a clean `dist/` left tools.json's stale
 * `{count:1, slugs:['pocketcasts-reset']}` in place (bin-tools.ts's
 * early-return path never called report.count() to overwrite it), which
 * countsEmitter's astro:build:done merge then read back as if it were
 * fresh -- the min-counts gate silently PASSED on a phantom tool that no
 * longer existed anywhere.
 *
 * This is deliberately a SEPARATE script from scripts/build-themes.mjs, not
 * logic bolted onto the top of it: build-themes.test.mjs invokes
 * build-themes.mjs directly as a real subprocess (many times, once per
 * test), and that subprocess doesn't set COUNTS_DIR -- if clearing lived
 * there, every `npx vitest run` would wipe the real, gitignored
 * src/data/generated/counts/ and counts.json as a side effect of running the
 * theme test suite. A standalone first step run only by `npm run build`
 * avoids that entanglement entirely.
 *
 * See scripts/lib/counts-integration.mjs's clearCounts() for the actual
 * (unit-tested) logic; this file is the thin CLI entry point that runs it
 * against the real repo paths.
 */

import { fileURLToPath } from 'node:url';
import { clearCounts } from './lib/counts-integration.mjs';

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  clearCounts();
  console.log('counts: cleared any stale counts manifest (COUNTS_DIR + counts.json) before this build');
}
