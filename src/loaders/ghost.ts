/*
 * ghost -- the `essays` + `essayTags` collections' loader (design spec §6:
 * "Ghost Content API, key as secret"). Task 12 fixed the `Essay` shape
 * consumers read (`src/lib/related.ts`); this module is what actually
 * populates the collections those consumers join against.
 *
 * ONE remote source, TWO collections. `essays` and `essayTags` come from the
 * same Ghost Content API pull (`/posts/` + `/tags/`), so a naive
 * implementation would fetch twice per build -- once per collection's
 * `load()`. Instead `loadGhostSnapshot()` below is a module-level memo: the
 * FIRST loader to call it runs the real `withFallback` cascade (live -> this
 * repo's `.cache/ghost.json` -> the committed vendor snapshot at
 * `src/data/vendor/ghost-snapshot.json`); the second loader's call reuses the
 * SAME promise (a resolved OR rejected one -- a total failure is cached too,
 * so a bad key doesn't cost two failed network round-trips).
 *
 * The memoized value's shape (`GhostSnapshot`) is deliberately the SAME shape
 * across live/cache/vendor tiers -- snake_case field names close to Ghost's
 * own JSON, e.g. `feature_image`/`published_at` -- so `validateGhostSnapshot`
 * is one schema, not the two-shapes-reconciled-by-one-validator dance
 * `github-meta.ts`'s `validateFor` needs (that reconciliation exists there
 * because the vendor file's shape differs from a single live result; here the
 * vendor file, once fetched live, IS what gets cached, so they never
 * diverge). The Astro-facing loaders below do the final camelCase reshaping
 * into what `content.config.ts`'s schemas expect, mirroring how
 * `github-meta.ts` keeps `pushedAt` a string until the collection's
 * `z.coerce.date()` sees it.
 *
 * **Never breaks `astro build` offline**, same contract as `github-meta.ts`:
 * a total cascade failure (no key configured, no cache, no vendor -- can't
 * happen with the vendor snapshot committed, but the code doesn't assume
 * that) leaves both collections empty with a warning, never a thrown error
 * out of either loader's `load()`.
 *
 * **No key configured**: `fetchGhostLive` throws immediately, before any
 * network call, when `GHOST_CONTENT_API_KEY` is unset (there is no secret yet
 * -- see the task brief). That throw is exactly what `withFallback`'s tier 1
 * treats as "live failed" -- it cascades straight to cache, then the
 * committed vendor snapshot, with a warning at each hop, never an error. This
 * is what makes today's build (no secret) quiet-warning instead of broken.
 */

import { z } from 'zod';
import type { Loader } from 'astro/loaders';
import { withFallback } from './lib/fallback';
import { report } from './lib/report';

const SOURCE = 'ghost';
const CONTENT_API_ORIGIN = 'https://starikov.co';
const POSTS_ENDPOINT = `${CONTENT_API_ORIGIN}/ghost/api/content/posts/`;
const TAGS_ENDPOINT = `${CONTENT_API_ORIGIN}/ghost/api/content/tags/`;
const POST_FIELDS = 'title,slug,url,custom_excerpt,excerpt,feature_image,published_at,reading_time';

const DEFAULT_CACHE_PATH = '.cache/ghost.json';
const DEFAULT_VENDOR_PATH = 'src/data/vendor/ghost-snapshot.json';

// ---------------------------------------------------------------------------
// Reading-time fallback
// ---------------------------------------------------------------------------

const WORDS_PER_MINUTE = 265;

/**
 * Ghost itself computes `reading_time` at ~265 words/minute from the post's
 * full html/plaintext; this loader only requests the metadata fields listed
 * in `POST_FIELDS` above (no `plaintext`), so the only text available if
 * `reading_time` is ever absent is the excerpt. Estimating from that instead
 * of failing the post is the pragmatic fallback -- it undercounts for a post
 * with a short excerpt but a long body, but a rough number beats none. Floors
 * at 1 minute (never "0 min read"). PURE.
 */
export function estimateReadingTime(text: string): number {
  const words = text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

// ---------------------------------------------------------------------------
// Shared snapshot shape (live result === cache file === vendor file)
// ---------------------------------------------------------------------------

export interface GhostPostSnapshot {
  title: string;
  slug: string;
  url: string;
  excerpt: string;
  feature_image: string | null;
  published_at: string;
  reading_time: number;
  tags: { slug: string }[];
}

export interface GhostTagSnapshot {
  name: string;
  slug: string;
  accent_color: string | null;
  description: string | null;
  count: number;
}

export interface GhostSnapshot {
  posts: GhostPostSnapshot[];
  tags: GhostTagSnapshot[];
}

const GhostPostSnapshotSchema = z.object({
  title: z.string(),
  slug: z.string(),
  url: z.string(),
  excerpt: z.string(),
  feature_image: z.string().nullable(),
  published_at: z.string(),
  reading_time: z.number(),
  tags: z.array(z.object({ slug: z.string() })),
});

const GhostTagSnapshotSchema = z.object({
  name: z.string(),
  slug: z.string(),
  accent_color: z.string().nullable(),
  description: z.string().nullable(),
  count: z.number(),
});

const GhostSnapshotSchema = z.object({
  posts: z.array(GhostPostSnapshotSchema),
  tags: z.array(GhostTagSnapshotSchema),
});

/** The `withFallback` `validate` callback shared by both collections --
 *  Zod-`.parse`-style: throws on a bad shape, returns it typed on success. */
export function validateGhostSnapshot(x: unknown): GhostSnapshot {
  return GhostSnapshotSchema.parse(x);
}

// ---------------------------------------------------------------------------
// Pure mappers: raw Ghost Content API JSON -> the shared snapshot shape.
// Tested against saved real-shape fixtures (never fetched live in tests).
// ---------------------------------------------------------------------------

// `include=tags` returns full tag objects (id, name, slug, visibility, ...);
// only `slug` is kept. `.loose()` so extra fields Ghost adds later don't break
// parsing (the non-deprecated equivalent of Zod 3's `.passthrough()`).
const RawContentPostSchema = z
  .object({
    title: z.string(),
    slug: z.string(),
    url: z.string(),
    custom_excerpt: z.string().nullable().optional(),
    excerpt: z.string().nullable().optional(),
    feature_image: z.string().nullable().optional(),
    published_at: z.string(),
    reading_time: z.number().nullable().optional(),
    tags: z.array(z.object({ slug: z.string() }).loose()).optional(),
  })
  .loose();

/** Raw Content API `/posts/` item -> `GhostPostSnapshot`. Throws (Zod) on a
 *  shape that isn't a post (e.g. a `{errors: [...]}` API error body). PURE. */
export function mapPost(json: unknown): GhostPostSnapshot {
  const raw = RawContentPostSchema.parse(json);
  const excerpt = raw.custom_excerpt ?? raw.excerpt ?? '';
  return {
    title: raw.title,
    slug: raw.slug,
    url: raw.url,
    excerpt,
    feature_image: raw.feature_image ?? null,
    published_at: raw.published_at,
    reading_time: raw.reading_time ?? estimateReadingTime(excerpt),
    tags: (raw.tags ?? []).map((t) => ({ slug: t.slug })),
  };
}

const RawContentTagSchema = z
  .object({
    name: z.string(),
    slug: z.string(),
    accent_color: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    // `include=count.posts` shape. Absent when that include wasn't requested.
    count: z.object({ posts: z.number() }).optional(),
  })
  .loose();

/** Raw Content API `/tags/` item -> `GhostTagSnapshot`. PURE. */
export function mapTag(json: unknown): GhostTagSnapshot {
  const raw = RawContentTagSchema.parse(json);
  return {
    name: raw.name,
    slug: raw.slug,
    accent_color: raw.accent_color ?? null,
    description: raw.description ?? null,
    count: raw.count?.posts ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Live fetch (the only network calls in this module; always injectable)
// ---------------------------------------------------------------------------

const PaginatedPostsSchema = z.object({
  posts: z.array(z.unknown()),
  meta: z.object({ pagination: z.object({ page: z.number(), pages: z.number() }) }),
});

const PaginatedTagsSchema = z.object({
  tags: z.array(z.unknown()),
  meta: z.object({ pagination: z.object({ page: z.number(), pages: z.number() }) }),
});

async function fetchAllPosts(key: string): Promise<GhostPostSnapshot[]> {
  const posts: GhostPostSnapshot[] = [];
  let page = 1;
  // `limit=all` means Ghost answers everything on page 1 in practice; the
  // loop still walks `meta.pagination` (brief: "paginate ... even though one
  // page suffices") so a future API change that ignores `limit=all` doesn't
  // silently truncate the essay list.
  for (;;) {
    const url = new URL(POSTS_ENDPOINT);
    url.searchParams.set('key', key);
    url.searchParams.set('limit', 'all');
    url.searchParams.set('include', 'tags');
    url.searchParams.set('fields', POST_FIELDS);
    url.searchParams.set('page', String(page));

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`Ghost Content API responded ${res.status} ${res.statusText} for posts page ${page}`);
    }
    const body = PaginatedPostsSchema.parse(await res.json());
    posts.push(...body.posts.map(mapPost));
    if (page >= body.meta.pagination.pages) break;
    page += 1;
  }
  return posts;
}

async function fetchAllTags(key: string): Promise<GhostTagSnapshot[]> {
  const tags: GhostTagSnapshot[] = [];
  let page = 1;
  for (;;) {
    const url = new URL(TAGS_ENDPOINT);
    url.searchParams.set('key', key);
    url.searchParams.set('limit', 'all');
    url.searchParams.set('include', 'count.posts');
    url.searchParams.set('page', String(page));

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`Ghost Content API responded ${res.status} ${res.statusText} for tags page ${page}`);
    }
    const body = PaginatedTagsSchema.parse(await res.json());
    tags.push(...body.tags.map(mapTag));
    if (page >= body.meta.pagination.pages) break;
    page += 1;
  }
  return tags;
}

/**
 * The real live fetch: both endpoints, in parallel. Throws immediately --
 * before any network call -- when `GHOST_CONTENT_API_KEY` isn't set (see
 * module doc: this is what lets `withFallback` cascade quietly to cache/
 * vendor instead of the build erroring on a secret that doesn't exist yet).
 * Exported so tests can prove the short-circuit without a real key; always
 * hard-fail-fast, never called directly by anything except `loadGhostSnapshot`
 * (as the default `fetchLive`) and tests.
 */
export async function fetchGhostLive(): Promise<GhostSnapshot> {
  const key = process.env.GHOST_CONTENT_API_KEY;
  if (!key) {
    throw new Error('GHOST_CONTENT_API_KEY is not configured; skipping the live Ghost fetch');
  }
  const [posts, tags] = await Promise.all([fetchAllPosts(key), fetchAllTags(key)]);
  return { posts, tags };
}

// ---------------------------------------------------------------------------
// The shared, memoized withFallback cascade
// ---------------------------------------------------------------------------

export interface GhostLoaderOptions {
  cachePath?: string;
  vendorPath?: string;
  /** Injectable live fetch. Defaults to `fetchGhostLive`. Tests MUST inject a
   *  fake here -- never hit the network in tests. */
  fetchLive?: () => Promise<GhostSnapshot>;
}

// Module-level memo: the whole point is ONE fetch shared by both collections
// per build (see module doc). Keyed on nothing but "has this build already
// resolved it" -- in real use both loaders call this with the SAME (default)
// options, so a single shared promise is exactly right. Reset between test
// cases via `resetGhostSnapshotCache`.
let snapshotPromise: Promise<{ data: GhostSnapshot; stale: boolean }> | null = null;

function loadGhostSnapshot(
  options: GhostLoaderOptions,
): Promise<{ data: GhostSnapshot; stale: boolean }> {
  if (!snapshotPromise) {
    snapshotPromise = withFallback<GhostSnapshot>({
      source: SOURCE,
      fetchLive: options.fetchLive ?? fetchGhostLive,
      cachePath: options.cachePath ?? DEFAULT_CACHE_PATH,
      vendorPath: options.vendorPath ?? DEFAULT_VENDOR_PATH,
      validate: validateGhostSnapshot,
      onVendor: 'warn',
    });
  }
  return snapshotPromise;
}

/** Test-only: clears the module-level memo so each test case gets a fresh
 *  cascade instead of reusing a previous test's (possibly failed) promise. */
export function resetGhostSnapshotCache(): void {
  snapshotPromise = null;
}

// ---------------------------------------------------------------------------
// The two Astro loaders
// ---------------------------------------------------------------------------

/** `essays` collection loader. Keys each entry by its Ghost slug. */
export function ghostEssaysLoader(options: GhostLoaderOptions = {}): Loader {
  return {
    name: 'ghost-essays',
    async load({ store, parseData, generateDigest, logger }) {
      store.clear();
      let result: { data: GhostSnapshot; stale: boolean };
      try {
        result = await loadGhostSnapshot(options);
      } catch (err) {
        report.warn(
          'ghost-essays',
          `Ghost snapshot unavailable (${(err as Error).message}); essays collection is empty`,
        );
        logger.warn('Ghost snapshot unavailable; essays collection is empty');
        return;
      }

      let loaded = 0;
      for (const post of result.data.posts) {
        const id = post.slug;
        const data = {
          title: post.title,
          url: post.url,
          excerpt: post.excerpt,
          featureImage: post.feature_image,
          publishedAt: post.published_at,
          readingTime: post.reading_time,
          tags: post.tags.map((t) => t.slug),
        };
        try {
          const validated = await parseData({ id, data });
          store.set({ id, data: validated, digest: generateDigest(data) });
          loaded += 1;
        } catch (err) {
          report.warn('ghost-essays', `post "${id}" rejected by schema (${(err as Error).message}); omitting`);
        }
      }
      logger.info(`loaded ${loaded}/${result.data.posts.length} essay(s)${result.stale ? ' (stale)' : ''}`);
    },
  };
}

/** `essayTags` collection loader. Keys each entry by its Ghost tag slug. */
export function ghostTagsLoader(options: GhostLoaderOptions = {}): Loader {
  return {
    name: 'ghost-tags',
    async load({ store, parseData, generateDigest, logger }) {
      store.clear();
      let result: { data: GhostSnapshot; stale: boolean };
      try {
        result = await loadGhostSnapshot(options);
      } catch (err) {
        report.warn(
          'ghost-tags',
          `Ghost snapshot unavailable (${(err as Error).message}); essayTags collection is empty`,
        );
        logger.warn('Ghost snapshot unavailable; essayTags collection is empty');
        return;
      }

      let loaded = 0;
      for (const tag of result.data.tags) {
        const id = tag.slug;
        const data = {
          name: tag.name,
          slug: tag.slug,
          accentColor: tag.accent_color,
          description: tag.description,
          count: tag.count,
        };
        try {
          const validated = await parseData({ id, data });
          store.set({ id, data: validated, digest: generateDigest(data) });
          loaded += 1;
        } catch (err) {
          report.warn('ghost-tags', `tag "${id}" rejected by schema (${(err as Error).message}); omitting`);
        }
      }
      logger.info(`loaded ${loaded}/${result.data.tags.length} tag(s)${result.stale ? ' (stale)' : ''}`);
    },
  };
}
