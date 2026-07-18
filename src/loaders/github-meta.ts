/*
 * github-meta -- the auto-generated `repos` collection loader (design spec §6:
 * "GitHub API metadata via plain fetch + GITHUB_TOKEN, per-repo stale
 * fallback"). One entry per repo in `SITE.projectRepos`, keyed by the repo's
 * lowercased "owner/name". Task 12's `projects` collection joins on this by
 * fullName to decorate a project page with live stars/pushedAt/etc.
 *
 * Each repo is fetched independently through `withFallback` (src/loaders/lib/
 * fallback.ts): live GitHub API call -> this repo's `.cache/github-meta/
 * <owner>--<name>.json` -> the single committed vendor snapshot at
 * `src/data/vendor/github-meta.json` (an object keyed by every repo's
 * lowercased fullName -- `validateFor` below extracts just this repo's entry
 * out of it). `onVendor: 'warn'` because this metadata is pure decoration
 * (stars, last-pushed, topics): a stale badge is fine, an empty build is not.
 *
 * **Never breaks `astro build` offline.** Each repo's ENTIRE pipeline --
 * withFallback's cascade AND the parseData/store.set that turns the result
 * into a stored entry -- is wrapped in one try/catch inside the loop. A repo
 * that fails all three withFallback tiers (no network, no prior cache, and no
 * entry for it in the vendor snapshot -- e.g. a repo added to
 * SITE.projectRepos after the last vendor refresh) OR that fails parseData
 * (e.g. content.config.ts's schema rejects a shape that slipped through --
 * see GithubRepoMetaSchema's pushedAt refinement for why that specific case
 * shouldn't happen, but the catch covers the class of failure regardless) is
 * simply omitted from the collection with a warning, and every other repo
 * still loads normally. In the worst case (every repo fails) `load()` still
 * resolves with an empty store plus one warning per repo, never a thrown
 * error out of the loader. This is a deliberate choice: /projects pages read
 * repo metadata as decoration (Task 12), not as something a missing entry
 * should fail the whole site over.
 */

import { join } from 'node:path';
import { z } from 'zod';
import type { Loader } from 'astro/loaders';
import { withFallback } from './lib/fallback';
import { report } from './lib/report';
import { SITE } from '../site.config.mjs';

const SOURCE = 'github-meta';
const GITHUB_API = 'https://api.github.com/repos/';

const DEFAULT_CACHE_ROOT = '.cache/github-meta';
const DEFAULT_VENDOR_PATH = 'src/data/vendor/github-meta.json';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** The internal, camelCase repo metadata shape -- what fetchLive resolves
 *  with, what gets written to a repo's cache file, and what one entry of the
 *  vendor file holds. `pushedAt` stays an ISO string here (not a real `Date`)
 *  so it round-trips through JSON.stringify/parse unchanged; the `repos`
 *  collection's Zod schema in content.config.ts is what coerces it to a
 *  `Date` for consumers, via `z.coerce.date()`. */
export interface GithubRepoMeta {
  fullName: string;
  description: string | null;
  stars: number;
  pushedAt: string;
  language: string | null;
  topics: string[];
  archived: boolean;
}

const GithubRepoMetaSchema = z.object({
  fullName: z.string(),
  description: z.string().nullable(),
  stars: z.number(),
  // Rejects unparseable garbage (a hand-edited or corrupted cache/vendor
  // JSON file) HERE, at the withFallback validate tier, where a bad tier
  // still falls through to the next one. Catching it only later, when
  // content.config.ts's `z.coerce.date()` parses the stored entry, would be
  // too late: parseData runs outside withFallback's cascade, so throwing
  // there has no fallback left to fall through to (see the loader's
  // per-repo try/catch for the belt-and-suspenders half of this fix).
  pushedAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
    message: 'pushedAt must be a parseable date string',
  }),
  language: z.string().nullable(),
  topics: z.array(z.string()),
  archived: z.boolean(),
});

// The subset of GitHub's `GET /repos/{owner}/{repo}` response shape this
// loader reads (https://docs.github.com/en/rest/repos/repos#get-a-repository).
// Extra fields (id, owner, license, …) are ignored, not rejected.
const RawGithubRepoSchema = z.object({
  full_name: z.string(),
  description: z.string().nullable(),
  stargazers_count: z.number(),
  pushed_at: z.string(),
  language: z.string().nullable(),
  topics: z.array(z.string()).default([]),
  archived: z.boolean(),
});

/**
 * Maps a raw GitHub API repo response to the internal shape. Pure -- no IO.
 * Tested against `test/fixtures/github/repo-response.json`, a hand-written
 * fixture in the documented API shape (never fetched live for the test).
 * Throws (Zod) on anything that isn't shaped like a repo response, e.g. a
 * `{"message": "Not Found"}` error body.
 */
export function mapRepoResponse(json: unknown): GithubRepoMeta {
  const raw = RawGithubRepoSchema.parse(json);
  return {
    fullName: raw.full_name,
    description: raw.description,
    stars: raw.stargazers_count,
    pushedAt: raw.pushed_at,
    language: raw.language,
    topics: raw.topics,
    archived: raw.archived,
  };
}

/** "IllyaStarikov/bin" -> "IllyaStarikov--bin.json" -- the per-repo cache filename. */
export function cacheFileFor(full: string): string {
  return `${full.replace('/', '--')}.json`;
}

/**
 * Builds the `validate` callback withFallback needs for one repo. It must
 * accept whatever `fetchLive` resolves with (already `GithubRepoMeta`-shaped)
 * AND whatever's on disk at the cache tier (same shape, since that's what
 * withFallback wrote there last time) AND whatever's on disk at the vendor
 * tier -- which is a DIFFERENT shape: one shared file keyed by every repo's
 * lowercased fullName. So: try parsing `x` directly as a single repo first;
 * if that fails, try `x[full.toLowerCase()]` (the vendor-file case) instead.
 * Throws when neither works.
 */
export function validateFor(full: string): (x: unknown) => GithubRepoMeta {
  return (x: unknown): GithubRepoMeta => {
    const direct = GithubRepoMetaSchema.safeParse(x);
    if (direct.success) return direct.data;

    if (x && typeof x === 'object') {
      const entry = (x as Record<string, unknown>)[full.toLowerCase()];
      if (entry !== undefined) return GithubRepoMetaSchema.parse(entry);
    }

    throw new Error(`no valid GitHub metadata for ${full} (direct: ${direct.error.message})`);
  };
}

// ---------------------------------------------------------------------------
// Live fetch (the only network call in this module; always injectable)
// ---------------------------------------------------------------------------

async function fetchRepoLive(full: string): Promise<GithubRepoMeta> {
  const res = await fetch(`${GITHUB_API}${full}`, {
    headers: {
      accept: 'application/vnd.github+json',
      ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API responded ${res.status} ${res.statusText} for ${full}`);
  }
  return mapRepoResponse(await res.json());
}

// ---------------------------------------------------------------------------
// The Astro loader
// ---------------------------------------------------------------------------

export interface GithubMetaLoaderOptions {
  /** "owner/name" identifiers to fetch. Defaults to `SITE.projectRepos`. */
  repos?: readonly string[];
  /** Root dir for per-repo cache files. Defaults to `.cache/github-meta`. */
  cacheRoot?: string;
  /** Path to the committed vendor snapshot. Defaults to `src/data/vendor/github-meta.json`. */
  vendorPath?: string;
  /** Injectable live fetch, one call per repo. Defaults to the real GitHub API
   *  call. Tests MUST inject a fake here -- never hit the network in tests. */
  fetchRepo?: (full: string) => Promise<GithubRepoMeta>;
}

/**
 * `repos` collection loader. See the module doc for the fallback cascade and
 * the "never break the build" contract.
 */
export function githubMetaLoader(options: GithubMetaLoaderOptions = {}): Loader {
  const repos = options.repos ?? SITE.projectRepos;
  const cacheRoot = options.cacheRoot ?? DEFAULT_CACHE_ROOT;
  const vendorPath = options.vendorPath ?? DEFAULT_VENDOR_PATH;
  const fetchRepo = options.fetchRepo ?? fetchRepoLive;

  return {
    name: SOURCE,
    async load({ store, parseData, generateDigest, logger }) {
      store.clear();
      let loaded = 0;

      for (const full of repos) {
        const source = `${SOURCE}:${full}`;
        // The WHOLE per-repo pipeline -- withFallback AND parseData/store.set
        // -- lives inside this one try/catch. parseData runs the collection's
        // Zod schema (content.config.ts), which can itself throw (an
        // AstroError) on a shape it doesn't like; if that happened outside
        // this catch it would abort the entire `load()` call and take every
        // OTHER repo down with it, breaking the "never breaks astro build
        // offline" guarantee documented above. One repo's failure -- at any
        // stage -- only ever costs that one repo.
        try {
          const result = await withFallback<GithubRepoMeta>({
            source,
            fetchLive: () => fetchRepo(full),
            cachePath: join(cacheRoot, cacheFileFor(full)),
            vendorPath,
            validate: validateFor(full),
            onVendor: 'warn',
          });

          const id = full.toLowerCase();
          const data = { ...result.data, stale: result.stale };
          const validated = await parseData({ id, data });
          store.set({ id, data: validated, digest: generateDigest(data) });
          loaded += 1;
        } catch (err) {
          report.warn(
            source,
            `unavailable or unusable (${(err as Error).message}); omitting from the repos collection`,
          );
        }
      }

      logger.info(`loaded ${loaded}/${repos.length} repo metadata entr${loaded === 1 ? 'y' : 'ies'}`);
    },
  };
}
