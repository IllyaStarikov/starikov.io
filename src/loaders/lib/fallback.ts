/*
 * withFallback -- the generic resilience primitive behind every remote-backed
 * loader (Task 11's GitHub metadata loader here; Task 14's Ghost essays loader
 * reuses this module unchanged).
 *
 * Every remote source in this site follows the same three-tier cascade (design
 * spec §7 "resilience matrix"):
 *
 *   1. LIVE -- call `fetchLive()`. On success, `validate` the shape and return
 *      `{stale: false}`. Persisting that data to `cachePath` (gitignored
 *      `.cache/`, parent directories created as needed) so a later run on
 *      this machine/CI job can fall back to it is a SEPARATE, best-effort
 *      side effect: a write failure there only warns -- it never turns a
 *      successful live fetch into a stale/failed result.
 *   2. CACHE -- on live failure (network error, non-2xx, bad shape), read and
 *      validate `cachePath`. Success returns `{stale: true}` with a warning;
 *      a missing/unreadable/invalid-shape cache falls through to tier 3.
 *   3. VENDOR -- read and validate the COMMITTED snapshot at `vendorPath`
 *      (`src/data/vendor/…`) -- the last line of defense, always present in
 *      the repo so a fresh clone with no network still builds. Its outcome
 *      follows `onVendor`:
 *        - `'warn'` (default): return `{stale: true}` with a warning. The
 *          source is decoration -- proceed on a possibly-old snapshot.
 *        - `'fail'`: throw even though the snapshot itself validated. No v1
 *          caller sets this yet, but the switch exists so a future source
 *          with a stricter policy (a stale build being unacceptable) doesn't
 *          need a new mechanism bolted on here.
 *
 * Exhausting all three tiers (or hitting an invalid vendor snapshot) throws an
 * Error naming `source`, so a caller that truly has nothing to serve fails
 * loudly instead of silently returning garbage.
 *
 * `validate` is the caller's Zod-`.parse`-style guard: it must throw on a bad
 * shape and return the typed value on success. It is applied uniformly to
 * whatever `fetchLive` resolves with AND to whatever tier 2/3 read off disk --
 * the loader modules that create these options are responsible for making
 * `fetchLive`'s resolved shape match what tier 2/3 persist (see
 * `src/loaders/github-meta.ts` for how a single-repo shape and a keyed vendor
 * file are reconciled).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { report } from './report';

export interface FallbackOptions<T> {
  /** Short identifier used in warnings/errors and thrown messages, e.g.
   *  "github-meta:IllyaStarikov/bin" -- specific enough to locate the failure. */
  source: string;
  fetchLive: () => Promise<T>;
  /** Gitignored per-run cache file (JSON). Parent directories are created as needed. */
  cachePath: string;
  /** Committed fallback snapshot (JSON), always present in the repo. */
  vendorPath: string;
  /** Parses/validates unknown JSON into T; throws on bad shape (Zod `.parse`-style). */
  validate: (data: unknown) => T;
  /** Policy once the cascade reaches the vendor snapshot. See module doc. Default `'warn'`. */
  onVendor?: 'warn' | 'fail';
}

export interface FallbackResult<T> {
  data: T;
  /** True whenever the data did not come from a successful live fetch this run. */
  stale: boolean;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type Attempt<T> = { ok: true; data: T } | { ok: false; error: unknown };

/** Reads + parses a JSON file and runs it through `validate`, without throwing. */
function tryReadValidate<T>(path: string, validate: (x: unknown) => T): Attempt<T> {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return { ok: true, data: validate(raw) };
  } catch (error) {
    return { ok: false, error };
  }
}

export async function withFallback<T>(opts: FallbackOptions<T>): Promise<FallbackResult<T>> {
  const { source, fetchLive, cachePath, vendorPath, validate, onVendor = 'warn' } = opts;

  // Tier 1: live. Fetching + validating is ONE failure domain (any failure
  // here means "no live data" -> fall through to cache). Persisting that
  // already-validated data to the cache file is a SEPARATE, best-effort side
  // effect: a write failure (permissions, full disk, a racing writer) must
  // never discard live data that was already successfully fetched and
  // validated, and must never be reported as though the live fetch itself
  // failed -- it only means the NEXT run won't have this to fall back to.
  let live: Attempt<T>;
  try {
    live = { ok: true, data: validate(await fetchLive()) };
  } catch (liveErr) {
    live = { ok: false, error: liveErr };
  }

  if (live.ok) {
    try {
      mkdirSync(dirname(cachePath), { recursive: true });
      writeFileSync(cachePath, JSON.stringify(live.data, null, 2));
    } catch (writeErr) {
      report.warn(
        source,
        `live fetch succeeded but writing the cache file at ${cachePath} failed (${errMsg(writeErr)}); continuing with live data, uncached`,
      );
    }
    return { data: live.data, stale: false };
  }
  report.warn(source, `live fetch failed (${errMsg(live.error)}); trying cached snapshot`);

  // Tier 2: cache.
  const cache = tryReadValidate(cachePath, validate);
  if (cache.ok) {
    report.warn(source, `using cached snapshot at ${cachePath} (stale)`);
    return { data: cache.data, stale: true };
  }
  report.warn(
    source,
    `cache unavailable at ${cachePath} (${errMsg(cache.error)}); trying vendor snapshot`,
  );

  // Tier 3: vendor.
  const vendor = tryReadValidate(vendorPath, validate);
  if (!vendor.ok) {
    throw new Error(
      `${source}: live fetch, cache, and vendor snapshot all failed -- vendor error: ${errMsg(vendor.error)}`,
    );
  }
  if (onVendor === 'fail') {
    throw new Error(
      `${source}: live and cache unavailable; refusing to serve the vendor snapshot per onVendor:"fail" policy`,
    );
  }
  report.warn(source, `using committed vendor snapshot at ${vendorPath} (stale)`);
  return { data: vendor.data, stale: true };
}
