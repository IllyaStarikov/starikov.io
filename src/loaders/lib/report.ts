/*
 * Shared warn/error/count reporter for content loaders (Task 9's bin loader,
 * Task 10's academia loader, and beyond).
 *
 * Loaders run in two contexts: `astro dev`/`astro build` on a developer's
 * machine, and the GitHub Actions build. GitHub's `::warning::`/`::error::`
 * annotation syntax renders nicely in the Actions UI but is just noisy
 * literal text on a human's local terminal -- so it's only emitted when
 * GITHUB_ACTIONS is set; locally we print plain, readable console output
 * instead. Either way every warn()/error() call increments a module-level
 * counter that flush() returns and resets, so callers (and tests) can assert
 * on counts without scraping stdout.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

let warnings = 0;
let errors = 0;

function inCI(): boolean {
  return Boolean(process.env.GITHUB_ACTIONS);
}

/*
 * count() -- Task 15's build-time counts manifest (src/data/generated/
 * counts.json, gitignored, read by scripts/validate-dist.mjs's hard gates).
 *
 * This is deliberately NOT an in-memory module-level counter like
 * warnings/errors above, even though that would read more naturally next to
 * flush(). Content-layer loaders (this module, imported from src/loaders/
 * *.ts) run inside Astro's content-sync Vite SSR module runner; the
 * `astro:build:done` integration hook that assembles counts.json
 * (scripts/lib/counts-integration.mjs) is reached via astro.config.mjs's own
 * dependency graph, which Vite loads through a SEPARATE esbuild-bundled
 * config-loading pass. Verified empirically (a throwaway probe integration +
 * loader pair) that a module-level counter bumped inside a loader reads back
 * as 0 from an astro:build:done hook "importing the same module" -- they are
 * two different instantiations of it, so in-memory state doesn't cross that
 * boundary. Environment variables DO cross it (process.env is one global per
 * process, not per module instantiation), so each call here writes one small
 * per-collection JSON file to COUNTS_DIR instead; the integration hook reads
 * the directory back with plain `fs`, no shared module state required.
 */

const DEFAULT_COUNTS_DIR = 'src/data/generated/counts';

function countsDir(): string {
  return process.env.COUNTS_DIR ?? DEFAULT_COUNTS_DIR;
}

export interface CollectionCount {
  count: number;
  /** Entry ids/slugs, when the caller has them (e.g. tools -- validate-dist
   *  diffs this against the slugs it finds by globbing dist/bin/*). Omitted
   *  when a collection has no meaningful notion of a "slug" to check. */
  slugs?: string[];
}

export const report = {
  warn(source: string, msg: string): void {
    warnings += 1;
    if (inCI()) {
      console.log(`::warning::${source}: ${msg}`);
    } else {
      console.warn(`${source}: ${msg}`);
    }
  },

  error(source: string, msg: string): void {
    errors += 1;
    if (inCI()) {
      console.log(`::error::${source}: ${msg}`);
    } else {
      console.error(`${source}: ${msg}`);
    }
  },

  /** Returns counts accumulated since the last flush(), then resets them to zero. */
  flush(): { warnings: number; errors: number } {
    const counts = { warnings, errors };
    warnings = 0;
    errors = 0;
    return counts;
  },

  /**
   * Records a collection's final entry count (+ optional slug list) into the
   * build's counts manifest. Loaders call this exactly once, after they've
   * finished writing entries to the content store, e.g.
   * `report.count('tools', loaded.size, [...loaded])`. Overwrites this
   * collection's own file each call -- last write for a given `collection`
   * name wins, which is exactly right for a single `astro build` (every
   * defined collection's loader runs once) and for a test re-invoking a
   * loader against a fresh COUNTS_DIR. See the module doc above for why this
   * is a per-collection file on disk rather than in-memory module state.
   */
  count(collection: string, n: number, slugs?: string[]): void {
    const dir = countsDir();
    mkdirSync(dir, { recursive: true });
    const entry: CollectionCount = slugs ? { count: n, slugs: [...slugs] } : { count: n };
    writeFileSync(join(dir, `${collection}.json`), JSON.stringify(entry));
  },
};
