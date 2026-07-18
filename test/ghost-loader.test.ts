import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  estimateReadingTime,
  mapPost,
  mapTag,
  validateGhostSnapshot,
  fetchGhostLive,
  ghostEssaysLoader,
  ghostTagsLoader,
  resetGhostSnapshotCache,
  type GhostSnapshot,
} from '../src/loaders/ghost';
import { report } from '../src/loaders/lib/report';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const POST_FIXTURE = JSON.parse(
  readFileSync(join(REPO_ROOT, 'test/fixtures/ghost/post-response.json'), 'utf8'),
);
const TAG_FIXTURE = JSON.parse(
  readFileSync(join(REPO_ROOT, 'test/fixtures/ghost/tag-response.json'), 'utf8'),
);
const VENDOR_SNAPSHOT_PATH = join(REPO_ROOT, 'src/data/vendor/ghost-snapshot.json');

afterEach(() => {
  report.flush();
  resetGhostSnapshotCache();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// estimateReadingTime -- pure word-count/265 fallback
// ---------------------------------------------------------------------------
describe('estimateReadingTime', () => {
  it('rounds word-count/265 to the nearest minute', () => {
    expect(estimateReadingTime(Array(530).fill('word').join(' '))).toBe(2);
  });

  it('never returns less than 1 minute, even for very short or empty text', () => {
    expect(estimateReadingTime('one two three')).toBe(1);
    expect(estimateReadingTime('')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// mapPost -- pure, tested against a saved real-shape Content API fixture
// ---------------------------------------------------------------------------
describe('mapPost', () => {
  it('maps the documented Content API post shape to the internal snapshot shape', () => {
    const post = mapPost(POST_FIXTURE);
    expect(post).toEqual({
      title: 'The Lifecycle of a Code Change',
      slug: 'commit-lifecycle',
      url: 'https://starikov.co/commit-lifecycle/',
      excerpt: "AI writes most of my code now. Here's where I let it, and where I don't.",
      feature_image: 'https://starikov.co/content/images/2026/06/commit_lifecycle_feature.png',
      published_at: '2026-07-14T13:01:17.000Z',
      reading_time: 14,
      tags: [{ slug: 'ai' }, { slug: 'software-engineering' }],
    });
  });

  it('prefers custom_excerpt over the auto-generated excerpt', () => {
    const post = mapPost({ ...POST_FIXTURE, custom_excerpt: 'A hand-written dek.' });
    expect(post.excerpt).toBe('A hand-written dek.');
  });

  it('falls back to excerpt when custom_excerpt is null', () => {
    const post = mapPost({ ...POST_FIXTURE, custom_excerpt: null, excerpt: 'Auto excerpt.' });
    expect(post.excerpt).toBe('Auto excerpt.');
  });

  it('falls back to an estimated reading time from the excerpt text when reading_time is absent', () => {
    const longExcerpt = Array(530).fill('word').join(' ');
    const post = mapPost({ ...POST_FIXTURE, reading_time: null, excerpt: longExcerpt, custom_excerpt: null });
    expect(post.reading_time).toBe(2);
  });

  it('defaults feature_image to null and tags to [] when absent', () => {
    const { feature_image, tags, ...rest } = POST_FIXTURE;
    const post = mapPost(rest);
    expect(post.feature_image).toBeNull();
    expect(post.tags).toEqual([]);
  });

  it('throws on a malformed / unrelated JSON shape', () => {
    expect(() => mapPost({ message: 'no such post' })).toThrow();
    expect(() => mapPost(null)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// mapTag -- pure, tested against a saved real-shape Content API fixture
// ---------------------------------------------------------------------------
describe('mapTag', () => {
  it('maps the documented Content API tag shape (nested count.posts) to the flat internal shape', () => {
    expect(mapTag(TAG_FIXTURE)).toEqual({
      name: 'Code',
      slug: 'code',
      accent_color: '#7aa2f7',
      description: 'Notes on writing software.',
      count: 23,
    });
  });

  it('defaults count to 0 when include=count.posts was not requested', () => {
    const { count, ...rest } = TAG_FIXTURE;
    expect(mapTag(rest).count).toBe(0);
  });

  it('defaults accent_color/description to null when absent', () => {
    const { accent_color, description, ...rest } = TAG_FIXTURE;
    const tag = mapTag(rest);
    expect(tag.accent_color).toBeNull();
    expect(tag.description).toBeNull();
  });

  it('throws on a malformed shape', () => {
    expect(() => mapTag({ nope: true })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateGhostSnapshot -- the withFallback validate callback; also proves the
// COMMITTED vendor snapshot (src/data/vendor/ghost-snapshot.json) is schema-
// valid, since that file is the site's last line of defense.
// ---------------------------------------------------------------------------
describe('validateGhostSnapshot', () => {
  it('accepts a well-shaped {posts, tags} snapshot', () => {
    const snapshot: GhostSnapshot = {
      posts: [mapPost(POST_FIXTURE)],
      tags: [mapTag(TAG_FIXTURE)],
    };
    expect(validateGhostSnapshot(snapshot)).toEqual(snapshot);
  });

  it('throws on garbage input', () => {
    expect(() => validateGhostSnapshot(null)).toThrow();
    expect(() => validateGhostSnapshot({ posts: 'nope' })).toThrow();
    expect(() => validateGhostSnapshot({})).toThrow();
  });

  it('the committed vendor snapshot parses cleanly and has >= 50 posts (min-count expectation)', () => {
    const raw = JSON.parse(readFileSync(VENDOR_SNAPSHOT_PATH, 'utf8'));
    const snapshot = validateGhostSnapshot(raw);
    expect(snapshot.posts.length).toBeGreaterThanOrEqual(50);
    expect(snapshot.tags.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// fetchGhostLive -- proves the "no key configured" short-circuit NEVER
// attempts a network call (build must stay quiet-warning, not error, per the
// withFallback cascade this feeds).
// ---------------------------------------------------------------------------
describe('fetchGhostLive', () => {
  it('throws immediately without calling fetch when GHOST_CONTENT_API_KEY is unset', async () => {
    vi.stubEnv('GHOST_CONTENT_API_KEY', '');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(fetchGhostLive()).rejects.toThrow(/GHOST_CONTENT_API_KEY/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ghostEssaysLoader / ghostTagsLoader -- the Astro loader shells. NEVER hit
// the real network: fetchLive is always injected. Exercises the shared-fetch
// memo, live success, cache fallback, vendor fallback, and "never break the
// build" (total failure -> empty collections + warning, never a throw).
// ---------------------------------------------------------------------------
interface StoredEntry {
  id: string;
  data: Record<string, unknown>;
  digest?: string | number;
}

function fakeContext(collection: string) {
  const map = new Map<string, StoredEntry>();
  const store = {
    set: (entry: StoredEntry) => {
      map.set(entry.id, entry);
      return true;
    },
    get: (key: string) => map.get(key),
    keys: () => [...map.keys()],
    values: () => [...map.values()],
    entries: () => [...map.entries()],
    has: (key: string) => map.has(key),
    delete: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    addModuleImport: () => {},
  };
  const logger = {
    info() {},
    warn() {},
    error() {},
    debug() {},
    options: {},
    label: 'test',
    fork: () => logger,
  };
  return {
    map,
    context: {
      collection,
      store,
      logger,
      meta: new Map(),
      config: {} as never,
      parseData: async ({ data }: { data: Record<string, unknown> }) => data,
      renderMarkdown: async (content: string) => ({ html: `<render>${content}</render>` }),
      generateDigest: (input: unknown) => `digest:${JSON.stringify(input).length}`,
    } as never,
  };
}

function snapshot(overrides: Partial<GhostSnapshot> = {}): GhostSnapshot {
  return {
    posts: [mapPost(POST_FIXTURE)],
    tags: [mapTag(TAG_FIXTURE)],
    ...overrides,
  };
}

describe('ghostEssaysLoader / ghostTagsLoader', () => {
  let parent: string;

  beforeAll(() => {
    parent = mkdtempSync(join(tmpdir(), 'ghost-loader-'));
  });

  afterAll(() => {
    rmSync(parent, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetGhostSnapshotCache();
  });

  it('loads posts into essays and tags into essayTags from one shared live fetch (called exactly once)', async () => {
    const cachePath = join(parent, 'shared-fetch', 'cache.json');
    const vendorPath = join(parent, 'shared-fetch', 'vendor.json');
    mkdirSync(join(parent, 'shared-fetch'), { recursive: true });
    writeFileSync(vendorPath, JSON.stringify(snapshot()));

    const fetchLive = vi.fn(async () => snapshot());
    const options = { cachePath, vendorPath, fetchLive };

    const essays = fakeContext('essays');
    const tags = fakeContext('essayTags');
    await ghostEssaysLoader(options).load(essays.context);
    await ghostTagsLoader(options).load(tags.context);

    expect(fetchLive).toHaveBeenCalledTimes(1);
    expect(essays.map.size).toBe(1);
    expect(essays.map.get('commit-lifecycle')!.data.title).toBe('The Lifecycle of a Code Change');
    expect(tags.map.size).toBe(1);
    expect(tags.map.get('code')!.data.name).toBe('Code');
  });

  it('essays entries are keyed by slug and shaped for the content schema (camelCase, tags as string[])', async () => {
    const cachePath = join(parent, 'shape', 'cache.json');
    const vendorPath = join(parent, 'shape', 'vendor.json');
    mkdirSync(join(parent, 'shape'), { recursive: true });
    writeFileSync(vendorPath, JSON.stringify(snapshot()));

    const { context, map } = fakeContext('essays');
    await ghostEssaysLoader({ cachePath, vendorPath, fetchLive: async () => snapshot() }).load(
      context,
    );

    const entry = map.get('commit-lifecycle')!.data;
    expect(entry).toEqual({
      title: 'The Lifecycle of a Code Change',
      url: 'https://starikov.co/commit-lifecycle/',
      excerpt: "AI writes most of my code now. Here's where I let it, and where I don't.",
      featureImage: 'https://starikov.co/content/images/2026/06/commit_lifecycle_feature.png',
      publishedAt: '2026-07-14T13:01:17.000Z',
      readingTime: 14,
      tags: ['ai', 'software-engineering'],
    });
  });

  it('falls back to the cache file when live fails, marking the run stale in the logger summary (never throws)', async () => {
    const cachePath = join(parent, 'cache-fallback', 'cache.json');
    const vendorPath = join(parent, 'cache-fallback', 'vendor.json');
    mkdirSync(join(parent, 'cache-fallback'), { recursive: true });
    writeFileSync(vendorPath, JSON.stringify(snapshot()));
    writeFileSync(
      cachePath,
      JSON.stringify(snapshot({ tags: [mapTag({ ...TAG_FIXTURE, slug: 'from-cache' })] })),
    );

    const { context, map } = fakeContext('essayTags');
    await expect(
      ghostTagsLoader({
        cachePath,
        vendorPath,
        fetchLive: async () => {
          throw new Error('network down');
        },
      }).load(context),
    ).resolves.not.toThrow();

    expect(map.has('from-cache')).toBe(true);
  });

  it('falls back to the committed vendor snapshot when live + cache both fail (quiet warning, not an error)', async () => {
    const cachePath = join(parent, 'vendor-fallback', 'cache.json'); // never written
    const vendorPath = join(parent, 'vendor-fallback', 'vendor.json');
    mkdirSync(join(parent, 'vendor-fallback'), { recursive: true });
    writeFileSync(vendorPath, JSON.stringify(snapshot({ posts: [mapPost({ ...POST_FIXTURE, slug: 'from-vendor' })] })));

    report.flush();
    const { context, map } = fakeContext('essays');
    await expect(
      ghostEssaysLoader({
        cachePath,
        vendorPath,
        fetchLive: async () => {
          throw new Error('no key configured');
        },
      }).load(context),
    ).resolves.not.toThrow();

    expect(map.has('from-vendor')).toBe(true);
    expect(report.flush().warnings).toBeGreaterThan(0);
  });

  it('when every tier fails, both collections end up empty with a warning -- never throws (quiet-warning build)', async () => {
    const cachePath = join(parent, 'total-failure', 'cache.json'); // missing
    const vendorPath = join(parent, 'total-failure', 'vendor.json'); // missing

    report.flush();
    const fetchLive = vi.fn(async () => {
      throw new Error('no key configured');
    });
    const options = { cachePath, vendorPath, fetchLive };
    const essays = fakeContext('essays');
    const tags = fakeContext('essayTags');

    await expect(ghostEssaysLoader(options).load(essays.context)).resolves.not.toThrow();
    // The shared memo caches the FAILED attempt too -- the second loader reuses
    // the same rejected promise rather than re-fetching, so fetchLive is still
    // only called once across both collections even on total failure.
    await expect(ghostTagsLoader(options).load(tags.context)).resolves.not.toThrow();

    expect(fetchLive).toHaveBeenCalledTimes(1);
    expect(essays.map.size).toBe(0);
    expect(tags.map.size).toBe(0);
    expect(report.flush().warnings).toBeGreaterThan(0);
  });
});
