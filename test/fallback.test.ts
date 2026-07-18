import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { withFallback } from '../src/loaders/lib/fallback';
import { report } from '../src/loaders/lib/report';

interface Payload {
  value: string;
}

/** Zod-.parse-style validator: throws on the wrong shape, else returns it typed. */
function validate(x: unknown): Payload {
  if (!x || typeof x !== 'object' || typeof (x as Payload).value !== 'string') {
    throw new Error('invalid payload shape');
  }
  return { value: (x as Payload).value };
}

afterEach(() => {
  // withFallback reports through the shared report module; drain between tests
  // so one test's warnings never leak into the next test's assertions.
  report.flush();
});

describe('withFallback', () => {
  let parent: string;
  let cachePath: string;
  let vendorPath: string;

  beforeAll(() => {
    parent = mkdtempSync(join(tmpdir(), 'fallback-'));
  });

  afterAll(() => {
    rmSync(parent, { recursive: true, force: true });
  });

  // Each test below carves out its own cache/vendor sub-paths (nested, so
  // mkdir -p is exercised) inside the shared temp root -- avoids cross-test
  // bleed without paying for a fresh mkdtemp per test.

  it('live success: validates, writes the cache file (mkdir -p parent), and returns stale:false', async () => {
    cachePath = join(parent, 'live-ok', 'nested', 'cache.json');
    vendorPath = join(parent, 'live-ok', 'vendor.json');
    expect(existsSync(cachePath)).toBe(false);

    const result = await withFallback<Payload>({
      source: 'test-source',
      fetchLive: async () => ({ value: 'from-live' }),
      cachePath,
      vendorPath,
      validate,
    });

    expect(result).toEqual({ data: { value: 'from-live' }, stale: false });
    expect(existsSync(cachePath)).toBe(true);
    expect(JSON.parse(readFileSync(cachePath, 'utf8'))).toEqual({ value: 'from-live' });
    expect(report.flush().warnings).toBe(0);
  });

  it('live failure, cache hit: returns the cached value with stale:true and warns', async () => {
    cachePath = join(parent, 'cache-hit', 'cache.json');
    vendorPath = join(parent, 'cache-hit', 'vendor.json');
    mkdirSync(join(parent, 'cache-hit'), { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ value: 'from-cache' }));

    const result = await withFallback<Payload>({
      source: 'test-source',
      fetchLive: async () => {
        throw new Error('network down');
      },
      cachePath,
      vendorPath,
      validate,
    });

    expect(result).toEqual({ data: { value: 'from-cache' }, stale: true });
    expect(report.flush().warnings).toBeGreaterThan(0);
  });

  it('live + cache both missing: falls back to vendor with stale:true and warns (onVendor default)', async () => {
    cachePath = join(parent, 'vendor-fallback', 'cache.json'); // never written
    vendorPath = join(parent, 'vendor-fallback', 'vendor.json');
    mkdirSync(join(parent, 'vendor-fallback'), { recursive: true });
    writeFileSync(vendorPath, JSON.stringify({ value: 'from-vendor' }));

    const result = await withFallback<Payload>({
      source: 'test-source',
      fetchLive: async () => {
        throw new Error('network down');
      },
      cachePath,
      vendorPath,
      validate,
    });

    expect(result).toEqual({ data: { value: 'from-vendor' }, stale: true });
    expect(report.flush().warnings).toBeGreaterThan(0);
  });

  it('live failure + cache present but invalid shape: skips the bad cache and falls to vendor', async () => {
    cachePath = join(parent, 'cache-invalid', 'cache.json');
    vendorPath = join(parent, 'cache-invalid', 'vendor.json');
    mkdirSync(join(parent, 'cache-invalid'), { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ nope: 'wrong shape' }));
    writeFileSync(vendorPath, JSON.stringify({ value: 'from-vendor' }));

    const result = await withFallback<Payload>({
      source: 'test-source',
      fetchLive: async () => {
        throw new Error('network down');
      },
      cachePath,
      vendorPath,
      validate,
    });

    expect(result).toEqual({ data: { value: 'from-vendor' }, stale: true });
  });

  it('all three tiers fail: throws an error naming the source', async () => {
    cachePath = join(parent, 'all-fail', 'cache.json'); // missing
    vendorPath = join(parent, 'all-fail', 'vendor.json'); // missing

    await expect(
      withFallback<Payload>({
        source: 'my-source-name',
        fetchLive: async () => {
          throw new Error('network down');
        },
        cachePath,
        vendorPath,
        validate,
      }),
    ).rejects.toThrow(/my-source-name/);
  });

  it('vendor present but invalid shape (live + cache also fail): throws naming the source', async () => {
    cachePath = join(parent, 'vendor-invalid', 'cache.json'); // missing
    vendorPath = join(parent, 'vendor-invalid', 'vendor.json');
    mkdirSync(join(parent, 'vendor-invalid'), { recursive: true });
    writeFileSync(vendorPath, JSON.stringify({ nope: 'wrong shape' }));

    await expect(
      withFallback<Payload>({
        source: 'vendor-invalid-source',
        fetchLive: async () => {
          throw new Error('network down');
        },
        cachePath,
        vendorPath,
        validate,
      }),
    ).rejects.toThrow(/vendor-invalid-source/);
  });

  it("onVendor:'fail' throws even though the vendor snapshot itself is valid", async () => {
    cachePath = join(parent, 'vendor-fail-policy', 'cache.json'); // missing
    vendorPath = join(parent, 'vendor-fail-policy', 'vendor.json');
    mkdirSync(join(parent, 'vendor-fail-policy'), { recursive: true });
    writeFileSync(vendorPath, JSON.stringify({ value: 'from-vendor' }));

    await expect(
      withFallback<Payload>({
        source: 'strict-source',
        fetchLive: async () => {
          throw new Error('network down');
        },
        cachePath,
        vendorPath,
        validate,
        onVendor: 'fail',
      }),
    ).rejects.toThrow(/strict-source/);
  });

  it('does not touch the cache or vendor files when the live fetch succeeds', async () => {
    cachePath = join(parent, 'live-ok-2', 'cache.json');
    vendorPath = join(parent, 'live-ok-2', 'vendor.json');
    mkdirSync(join(parent, 'live-ok-2'), { recursive: true });
    writeFileSync(vendorPath, JSON.stringify({ value: 'stale-vendor-should-be-ignored' }));

    const result = await withFallback<Payload>({
      source: 'test-source',
      fetchLive: async () => ({ value: 'fresh' }),
      cachePath,
      vendorPath,
      validate,
    });

    expect(result).toEqual({ data: { value: 'fresh' }, stale: false });
    // vendor file is untouched (still holds its original content, not overwritten)
    expect(JSON.parse(readFileSync(vendorPath, 'utf8'))).toEqual({
      value: 'stale-vendor-should-be-ignored',
    });
  });
});
