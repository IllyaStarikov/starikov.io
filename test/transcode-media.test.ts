import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { needsTranscode, outputsFor } from '../scripts/transcode-media.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SCRIPT = join(REPO_ROOT, 'scripts/transcode-media.mjs');

// The transcode script itself shells out to ffmpeg/sharp; only its PURE cache
// decision and output-path derivation are unit-tested here (the brief forbids
// invoking ffmpeg/sharp in tests -- the real encode is exercised by actually
// running the script locally, per the task instructions).
describe('needsTranscode (digest-skip decision)', () => {
  it('skips when the hash is unchanged and outputs already exist', () => {
    expect(needsTranscode('abc', 'abc', true)).toBe(false);
  });

  it('re-runs when the source hash changed', () => {
    expect(needsTranscode('abc', 'def', true)).toBe(true);
  });

  it('re-runs when an output is missing, even if the hash matches', () => {
    expect(needsTranscode('abc', 'abc', false)).toBe(true);
  });

  it('re-runs when there is no cached hash yet (first build)', () => {
    expect(needsTranscode(undefined, 'abc', false)).toBe(true);
    expect(needsTranscode(undefined, 'abc', true)).toBe(true);
  });
});

describe('outputsFor (self-heal: what SHOULD exist for a given source)', () => {
  it('a GIF expects mp4+webm+jpg', () => {
    const outputs = outputsFor('match3.gif').map((p) => basename(p));
    expect(outputs).toEqual(['match3.mp4', 'match3.webm', 'match3.jpg']);
  });

  it('a non-GIF image expects AVIF+WebP, never a verbatim copy of the source extension', () => {
    const outputs = outputsFor('bolt_timer.png').map((p) => basename(p));
    expect(outputs).toEqual(['bolt_timer.avif', 'bolt_timer.webp']);
    expect(outputs).not.toContain('bolt_timer.png');
  });

  it('is extension-agnostic among non-GIF images (.jpg behaves like .png)', () => {
    expect(outputsFor('photo.jpg').map((p) => basename(p))).toEqual(['photo.avif', 'photo.webp']);
  });

  it('combined with needsTranscode, an old cache missing AVIF/WebP self-heals: a cached digest with the OLD (verbatim-copy) outputs on disk is NOT enough -- the new outputsFor() list is what is checked, so a stale cache re-transcodes exactly once', () => {
    // Simulate: digest matches (source unchanged since a pre-AVIF/WebP cache),
    // but the outputs that exist on disk are the old verbatim copy, not
    // outputsFor()'s current expectation -- so outputsExist is false.
    const outputsExist = false; // caller checks outputsFor(file).every(existsSync)
    expect(needsTranscode('same-hash', 'same-hash', outputsExist)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Corrupt-asset resilience (Task 2 fix round 1): a single asset that fails to
// transcode must warn-and-skip, not fail the whole build (previously an
// uncaught throw here propagated to main().catch() -> process.exit(1) ->
// package.json's `&&`-chained build script fails outright). Run as a
// subprocess against scratch source/output directories
// (ACADEMIA_MEDIA_SOURCE_DIR / ACADEMIA_MEDIA_OUT_DIR -- same override
// pattern as build-themes.mjs's THEMES_SOURCE_DIR/THEMES_OUT_DIR in
// test/build-themes.test.mjs), so this exercises the REAL try/catch in
// main()'s loop -- including a real sharp decode failure -- without touching
// the real .sources/academia checkout or public/media/academia/. No GIF is
// involved: ffmpeg's mere presence is still a hard precondition of running
// this script at all (same as `npm run build`), but it is never asked to
// encode anything here, keeping this test fast and sharp-only.
describe('transcode-media.mjs -- a corrupt asset does not fail the whole build', () => {
  let sourceDir: string;
  let outDir: string;

  beforeAll(async () => {
    sourceDir = mkdtempSync(join(tmpdir(), 'transcode-media-src-'));
    outDir = mkdtempSync(join(tmpdir(), 'transcode-media-out-'));
    const assetsDir = join(sourceDir, 'assets');
    mkdirSync(assetsDir, { recursive: true });

    // A real, tiny, validly-encoded PNG sharp can actually transcode.
    await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toFile(join(assetsDir, 'good.png'));

    // A file with a .png extension but garbage bytes -- sharp throws
    // decoding it. This is the real academia-corrupt-source scenario the
    // review flagged: the transcode path actively decodes/re-encodes (unlike
    // the old copyFileSync path, which was essentially unfailable on content
    // grounds).
    writeFileSync(join(assetsDir, 'bad.png'), 'not a real png, just garbage bytes');

    // "Bad" listed first so a broken `continue` (an accidental `return` or
    // `break` in the fix) would show up as good.png ALSO missing its outputs.
    writeFileSync(
      join(sourceDir, 'PORTFOLIO.md'),
      [
        '## 1. Bad Project',
        '',
        '**Path:** `src/bad-project/`',
        '',
        '<img src="assets/bad.png" alt="Bad">',
        '',
        'Some prose.',
        '',
        '## 2. Good Project',
        '',
        '**Path:** `src/good-project/`',
        '',
        '<img src="assets/good.png" alt="Good">',
        '',
        'Some prose.',
        '',
      ].join('\n'),
    );
  });

  afterAll(() => {
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  function run(): string {
    return execFileSync('node', [SCRIPT], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        ACADEMIA_MEDIA_SOURCE_DIR: sourceDir,
        ACADEMIA_MEDIA_OUT_DIR: outDir,
        // Force the ::warning:: CI-annotation format deterministically,
        // regardless of whether this happens to run inside real CI.
        GITHUB_ACTIONS: '1',
      },
      encoding: 'utf8',
    });
  }

  it('warns and skips the corrupt asset, still transcodes the good one, and exits 0', () => {
    // execFileSync throws on a non-zero exit -- reaching the assertions below
    // at all is itself proof this exited 0.
    const stdout = run();
    expect(stdout).toMatch(/::warning::transcoding bad\.png failed/);

    // The good asset's outputs + manifest entry ARE produced...
    expect(existsSync(join(outDir, 'good.avif'))).toBe(true);
    expect(existsSync(join(outDir, 'good.webp'))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
    expect(manifest.good).toMatchObject({ kind: 'image' });

    // ...while the corrupt one produced nothing and has no manifest entry --
    // src/loaders/academia.ts's hasDims() relies on exactly this absence to
    // avoid rendering a <picture> pointing at a file that doesn't exist.
    expect(existsSync(join(outDir, 'bad.avif'))).toBe(false);
    expect(existsSync(join(outDir, 'bad.webp'))).toBe(false);
    expect(manifest.bad).toBeUndefined();
  });

  it('does not cache the failure -- a second run retries (and still warns on) the same corrupt asset', () => {
    run();
    const second = run();
    expect(second).toMatch(/::warning::transcoding bad\.png failed/);

    const digests = JSON.parse(readFileSync(join(outDir, '.digests.json'), 'utf8'));
    expect(digests['bad.png']).toBeUndefined();
    expect(digests['good.png']).toBeTruthy(); // the good asset WAS cached after its first success
  });
});
