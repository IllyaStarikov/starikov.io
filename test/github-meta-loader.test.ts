import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  mapRepoResponse,
  cacheFileFor,
  validateFor,
  githubMetaLoader,
  type GithubRepoMeta,
} from '../src/loaders/github-meta';
import { report } from '../src/loaders/lib/report';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const RAW_RESPONSE = JSON.parse(
  readFileSync(join(REPO_ROOT, 'test/fixtures/github/repo-response.json'), 'utf8'),
);

afterEach(() => {
  report.flush();
});

// ---------------------------------------------------------------------------
// mapRepoResponse -- pure, tested against a saved real-shape API fixture
// (never fetched live; see task-11-report.md for why)
// ---------------------------------------------------------------------------
describe('mapRepoResponse', () => {
  it('maps the documented GitHub API repo shape to the internal camelCase shape', () => {
    const meta = mapRepoResponse(RAW_RESPONSE);
    expect(meta).toEqual({
      fullName: 'IllyaStarikov/bin',
      description: 'A collection of small, focused command-line tools.',
      stars: 27,
      pushedAt: '2026-07-01T08:22:31Z',
      language: 'Python',
      topics: ['cli', 'python', 'shell', 'productivity'],
      archived: false,
    });
  });

  it('preserves null description/language rather than coercing to a string', () => {
    const meta = mapRepoResponse({
      ...RAW_RESPONSE,
      description: null,
      language: null,
      topics: [],
    });
    expect(meta.description).toBeNull();
    expect(meta.language).toBeNull();
    expect(meta.topics).toEqual([]);
  });

  it('defaults topics to [] when the field is absent (older API responses)', () => {
    const { topics, ...withoutTopics } = RAW_RESPONSE;
    const meta = mapRepoResponse(withoutTopics);
    expect(meta.topics).toEqual([]);
  });

  it('throws on a malformed / unrelated JSON shape', () => {
    expect(() => mapRepoResponse({ message: 'Not Found' })).toThrow();
    expect(() => mapRepoResponse(null)).toThrow();
    expect(() => mapRepoResponse('nope')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// cacheFileFor -- pure "owner/name" -> cache filename
// ---------------------------------------------------------------------------
describe('cacheFileFor', () => {
  it('replaces the single "/" with "--" and appends .json', () => {
    expect(cacheFileFor('IllyaStarikov/bin')).toBe('IllyaStarikov--bin.json');
    expect(cacheFileFor('IllyaStarikov/.dotfiles')).toBe('IllyaStarikov--.dotfiles.json');
  });
});

// ---------------------------------------------------------------------------
// validateFor -- reconciles the two on-disk shapes withFallback's single
// `validate` callback must handle: a single-repo object (live result / the
// per-repo cache file) and the shared vendor file keyed by lowercased fullName.
// ---------------------------------------------------------------------------
describe('validateFor', () => {
  const meta: GithubRepoMeta = {
    fullName: 'IllyaStarikov/bin',
    description: 'desc',
    stars: 1,
    pushedAt: '2026-01-01T00:00:00Z',
    language: 'Python',
    topics: [],
    archived: false,
  };

  it('validates a direct single-repo object (live result / per-repo cache file shape)', () => {
    expect(validateFor('IllyaStarikov/bin')(meta)).toEqual(meta);
  });

  it('extracts this repo from a vendor file keyed by lowercased fullName', () => {
    const vendorFile = {
      'illyastarikov/bin': meta,
      'illyastarikov/eclecta': { ...meta, fullName: 'IllyaStarikov/eclecta' },
    };
    expect(validateFor('IllyaStarikov/bin')(vendorFile)).toEqual(meta);
  });

  it('throws when the vendor file does not contain an entry for this repo', () => {
    const vendorFile = { 'illyastarikov/eclecta': { ...meta, fullName: 'IllyaStarikov/eclecta' } };
    expect(() => validateFor('IllyaStarikov/bin')(vendorFile)).toThrow();
  });

  it('throws on garbage input', () => {
    expect(() => validateFor('IllyaStarikov/bin')(42)).toThrow();
    expect(() => validateFor('IllyaStarikov/bin')(null)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// githubMetaLoader -- the Astro loader shell. NEVER hits the real GitHub API:
// fetchRepo is always injected. Exercises live success, per-repo cache
// fallback, shared-vendor fallback, and the "never break the build" contract
// (one repo's total failure just gets omitted + warned, not thrown).
// ---------------------------------------------------------------------------
interface StoredEntry {
  id: string;
  data: Record<string, unknown>;
  digest?: string | number;
}

function fakeContext() {
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
      collection: 'repos',
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

function metaFor(fullName: string, overrides: Partial<GithubRepoMeta> = {}): GithubRepoMeta {
  return {
    fullName,
    description: `desc for ${fullName}`,
    stars: 10,
    pushedAt: '2026-01-01T00:00:00Z',
    language: 'Python',
    topics: [],
    archived: false,
    ...overrides,
  };
}

describe('githubMetaLoader', () => {
  let parent: string;
  let cacheRoot: string;
  let vendorPath: string;

  beforeAll(() => {
    parent = mkdtempSync(join(tmpdir(), 'github-meta-loader-'));
  });

  afterAll(() => {
    rmSync(parent, { recursive: true, force: true });
  });

  it('loads every repo via the injected live fetch, keying by lowercased fullName, stale:false', async () => {
    cacheRoot = join(parent, 'live-ok', 'cache');
    vendorPath = join(parent, 'live-ok', 'vendor.json');
    mkdirSync(join(parent, 'live-ok'), { recursive: true });
    writeFileSync(vendorPath, JSON.stringify({}));

    const { context, map } = fakeContext();
    const repos = ['IllyaStarikov/bin', 'IllyaStarikov/eclecta'];
    const fetchRepo = async (full: string) => metaFor(full);

    await githubMetaLoader({ repos, cacheRoot, vendorPath, fetchRepo }).load(context);

    expect(new Set(map.keys())).toEqual(new Set(['illyastarikov/bin', 'illyastarikov/eclecta']));
    const bin = map.get('illyastarikov/bin')!.data;
    expect(bin.fullName).toBe('IllyaStarikov/bin');
    expect(bin.stale).toBe(false);
    expect(bin.stars).toBe(10);
  });

  it('falls back to the per-repo cache file when the live fetch fails, marking stale:true', async () => {
    cacheRoot = join(parent, 'cache-fallback', 'cache');
    vendorPath = join(parent, 'cache-fallback', 'vendor.json');
    mkdirSync(cacheRoot, { recursive: true });
    writeFileSync(vendorPath, JSON.stringify({}));
    writeFileSync(
      join(cacheRoot, cacheFileFor('IllyaStarikov/bin')),
      JSON.stringify(metaFor('IllyaStarikov/bin', { stars: 99 })),
    );

    const { context, map } = fakeContext();
    const fetchRepo = async () => {
      throw new Error('rate limited');
    };

    await githubMetaLoader({
      repos: ['IllyaStarikov/bin'],
      cacheRoot,
      vendorPath,
      fetchRepo,
    }).load(context);

    const bin = map.get('illyastarikov/bin')!.data;
    expect(bin.stale).toBe(true);
    expect(bin.stars).toBe(99);
  });

  it('falls back to the shared vendor snapshot when live + cache both fail, extracting this repo only', async () => {
    cacheRoot = join(parent, 'vendor-fallback', 'cache'); // empty, no cache files
    vendorPath = join(parent, 'vendor-fallback', 'vendor.json');
    mkdirSync(cacheRoot, { recursive: true });
    writeFileSync(
      vendorPath,
      JSON.stringify({
        'illyastarikov/bin': metaFor('IllyaStarikov/bin', { stars: 5 }),
        'illyastarikov/eclecta': metaFor('IllyaStarikov/eclecta', { stars: 7 }),
      }),
    );

    const { context, map } = fakeContext();
    const fetchRepo = async () => {
      throw new Error('offline');
    };

    await githubMetaLoader({
      repos: ['IllyaStarikov/bin', 'IllyaStarikov/eclecta'],
      cacheRoot,
      vendorPath,
      fetchRepo,
    }).load(context);

    expect(map.get('illyastarikov/bin')!.data.stars).toBe(5);
    expect(map.get('illyastarikov/eclecta')!.data.stars).toBe(7);
    expect(map.get('illyastarikov/bin')!.data.stale).toBe(true);
  });

  it('never throws when every tier fails for a repo -- omits it, warns, and keeps loading the rest', async () => {
    cacheRoot = join(parent, 'total-failure', 'cache');
    vendorPath = join(parent, 'total-failure', 'vendor.json');
    mkdirSync(cacheRoot, { recursive: true });
    // Vendor only has an entry for eclecta, not bin -- bin has nothing to fall
    // back to at all (live fails, no cache file, no vendor entry).
    writeFileSync(
      vendorPath,
      JSON.stringify({ 'illyastarikov/eclecta': metaFor('IllyaStarikov/eclecta') }),
    );

    const { context, map } = fakeContext();
    report.flush();
    const fetchRepo = async () => {
      throw new Error('offline');
    };

    await expect(
      githubMetaLoader({
        repos: ['IllyaStarikov/bin', 'IllyaStarikov/eclecta'],
        cacheRoot,
        vendorPath,
        fetchRepo,
      }).load(context),
    ).resolves.not.toThrow();

    expect(map.has('illyastarikov/bin')).toBe(false);
    expect(map.has('illyastarikov/eclecta')).toBe(true);
    expect(report.flush().warnings).toBeGreaterThan(0);
  });

  it('produces an empty store (never throws) when every repo fails every tier', async () => {
    cacheRoot = join(parent, 'all-empty', 'cache');
    vendorPath = join(parent, 'all-empty', 'vendor.json');
    mkdirSync(cacheRoot, { recursive: true });
    writeFileSync(vendorPath, JSON.stringify({}));

    const { context, map } = fakeContext();
    report.flush();
    const fetchRepo = async () => {
      throw new Error('offline');
    };

    await expect(
      githubMetaLoader({
        repos: ['IllyaStarikov/bin'],
        cacheRoot,
        vendorPath,
        fetchRepo,
      }).load(context),
    ).resolves.not.toThrow();

    expect(map.size).toBe(0);
    expect(report.flush().warnings).toBeGreaterThan(0);
  });
});
