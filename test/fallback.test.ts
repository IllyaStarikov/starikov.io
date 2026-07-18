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

  it('live success overwrites the cache file with fresh data but leaves the vendor snapshot untouched', async () => {
    cachePath = join(parent, 'live-ok-2', 'cache.json');
    vendorPath = join(parent, 'live-ok-2', 'vendor.json');
    mkdirSync(join(parent, 'live-ok-2'), { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ value: 'stale-cache-should-be-overwritten' }));
    writeFileSync(vendorPath, JSON.stringify({ value: 'stale-vendor-should-be-ignored' }));

    const result = await withFallback<Payload>({
      source: 'test-source',
      fetchLive: async () => ({ value: 'fresh' }),
      cachePath,
      vendorPath,
      validate,
    });

    expect(result).toEqual({ data: { value: 'fresh' }, stale: false });
    // the cache file IS written on live success -- overwritten with the fresh data.
    expect(JSON.parse(readFileSync(cachePath, 'utf8'))).toEqual({ value: 'fresh' });
    // vendor file is untouched (still holds its original content, not overwritten).
    expect(JSON.parse(readFileSync(vendorPath, 'utf8'))).toEqual({
      value: 'stale-vendor-should-be-ignored',
    });
  });

  it('cache is preferred over vendor when both exist with different values', async () => {
    cachePath = join(parent, 'tier-order', 'cache.json');
    vendorPath = join(parent, 'tier-order', 'vendor.json');
    mkdirSync(join(parent, 'tier-order'), { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ value: 'from-cache' }));
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

    // Tier 2 (cache) wins over tier 3 (vendor) even though both are valid.
    expect(result).toEqual({ data: { value: 'from-cache' }, stale: true });
  });

  it('live success returns stale:false with live data (and warns) even when the cache write fails', async () => {
    const parentDir = join(parent, 'cache-write-fails');
    mkdirSync(parentDir, { recursive: true });
    vendorPath = join(parentDir, 'vendor.json');
    writeFileSync(vendorPath, JSON.stringify({ value: 'vendor-untouched' }));

    // Point cachePath's PARENT at a path that is itself a plain FILE, so
    // `mkdirSync(dirname(cachePath), {recursive:true})` fails with ENOTDIR --
    // an unwritable cache location without needing OS-level permission games.
    const blockerFile = join(parentDir, 'blocker');
    writeFileSync(blockerFile, 'not a directory');
    cachePath = join(blockerFile, 'nested', 'cache.json');

    const result = await withFallback<Payload>({
      source: 'test-source',
      fetchLive: async () => ({ value: 'from-live' }),
      cachePath,
      vendorPath,
      validate,
    });

    // The already-validated live data is NOT discarded by the cache-write
    // failure: still stale:false, still the live value.
    expect(result).toEqual({ data: { value: 'from-live' }, stale: false });
    expect(report.flush().warnings).toBeGreaterThan(0);
    // Vendor was never read/touched -- live succeeded.
    expect(JSON.parse(readFileSync(vendorPath, 'utf8'))).toEqual({ value: 'vendor-untouched' });
  });
});
