/*
 * Shared warn/error reporter for content loaders (Task 9's bin loader,
 * Task 10's academia loader, and beyond).
 *
 * Loaders run in two contexts: `astro dev`/`astro build` on a developer's
 * machine, and the GitHub Actions build. GitHub's `::warning::`/`::error::`
 * annotation syntax renders nicely in the Actions UI but is just noisy
 * literal text on a human's local terminal -- so it's only emitted when
 * GITHUB_ACTIONS is set; locally we print plain, readable console output
 * instead. Either way every call increments a module-level counter that
 * flush() returns and resets, so callers (and tests) can assert on counts
 * without scraping stdout.
 */

let warnings = 0;
let errors = 0;

function inCI(): boolean {
  return Boolean(process.env.GITHUB_ACTIONS);
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
};
