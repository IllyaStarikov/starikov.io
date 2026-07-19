import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SCRIPT = join(REPO_ROOT, 'scripts/build-themes.mjs');
const OK_FIXTURE = join(REPO_ROOT, 'test/fixtures/themes-ok');
const CORRUPT_FIXTURE = join(REPO_ROOT, 'test/fixtures/themes-corrupt');

// THEMES_OUT_DIR (build-themes.mjs) redirects both generated outputs under a
// scratch root for the whole suite. Before this, every `it()` here ran the
// real script against the real src/styles/themes.generated.css + src/data/
// generated/themes.json -- so simply running `npx vitest run` clobbered
// whatever a genuine `npm run build` had generated (the full 8-family curated
// set) with this suite's reduced two-family fixture, corrupting local dev
// state and making test/theme-boot.test.mjs's catppuccin-dependent assertion
// order-dependent (hence its `it.skipIf(!PAIRS.catppuccin)` guard). Isolating
// the output directory here removes the corruption at the source.
let OUT_DIR;
let OUT_CSS;
let OUT_JSON;
let OUT_ALL_JSON;

beforeAll(() => {
  OUT_DIR = mkdtempSync(join(tmpdir(), 'build-themes-out-'));
  OUT_CSS = join(OUT_DIR, 'src/styles/themes.generated.css');
  OUT_JSON = join(OUT_DIR, 'src/data/generated/themes.json');
  OUT_ALL_JSON = join(OUT_DIR, 'src/data/generated/themes-all.json');
});

afterAll(() => {
  rmSync(OUT_DIR, { recursive: true, force: true });
});

function runBuild(env) {
  return execFileSync('node', [SCRIPT], {
    cwd: REPO_ROOT,
    env: { ...process.env, THEMES_OUT_DIR: OUT_DIR, ...env },
    encoding: 'utf8',
  });
}

describe('build-themes.mjs -- happy path against a real two-family fixture', () => {
  it('runs successfully and generates CSS + JSON', () => {
    const stdout = runBuild({ THEMES_SOURCE_DIR: OK_FIXTURE });
    expect(stdout).toMatch(/themes: \d+ families, \d+ variants, css [\d.]+ KB/);
    expect(existsSync(OUT_CSS)).toBe(true);
    expect(existsSync(OUT_JSON)).toBe(true);
  });

  it('emits a [data-theme="tokyonight-storm"] block with derived text tokens', () => {
    runBuild({ THEMES_SOURCE_DIR: OK_FIXTURE });
    const css = readFileSync(OUT_CSS, 'utf8');
    expect(css).toContain('[data-theme="tokyonight-storm"]');
    expect(css).toContain('--code-comment');
  });

  it('never maps the Shiki comment token to --muted (token a11y contract)', () => {
    runBuild({ THEMES_SOURCE_DIR: OK_FIXTURE });
    const css = readFileSync(OUT_CSS, 'utf8');
    expect(css).not.toContain('--astro-code-token-comment:var(--muted)');
    // Positive check: it must map to --code-comment instead.
    expect(css).toContain('--astro-code-token-comment:var(--code-comment)');
  });

  it('themes.json family pairs resolve to variant ids that actually exist', () => {
    runBuild({ THEMES_SOURCE_DIR: OK_FIXTURE });
    const themes = JSON.parse(readFileSync(OUT_JSON, 'utf8'));

    expect(themes.families.length).toBeGreaterThan(0);
    for (const family of themes.families) {
      const ids = new Set(family.variants.map((v) => v.id));
      expect(ids.has(family.pair.light)).toBe(true);
      expect(ids.has(family.pair.dark)).toBe(true);
    }

    // defaults must also resolve to a real emitted variant id somewhere.
    const allIds = new Set(themes.families.flatMap((f) => f.variants.map((v) => v.id)));
    expect(allIds.has(themes.defaults.light)).toBe(true);
    expect(allIds.has(themes.defaults.dark)).toBe(true);
  });

  it('only includes tokyonight + github (the two families present in the fixture manifest)', () => {
    runBuild({ THEMES_SOURCE_DIR: OK_FIXTURE });
    const themes = JSON.parse(readFileSync(OUT_JSON, 'utf8'));
    const ids = themes.families.map((f) => f.id).sort();
    expect(ids).toEqual(['github', 'tokyonight']);
  });
});

describe('build-themes.mjs -- themes-all.json (the full /colophon gallery data)', () => {
  it('emits themes-all.json with every family/variant on disk (swatches only, no CSS)', () => {
    runBuild({ THEMES_SOURCE_DIR: OK_FIXTURE });
    expect(existsSync(OUT_ALL_JSON)).toBe(true);
    const all = JSON.parse(readFileSync(OUT_ALL_JSON, 'utf8'));
    expect(Array.isArray(all.families)).toBe(true);

    // Every family object uses the brief's field names and carries only swatches.
    for (const family of all.families) {
      expect(typeof family.familyId).toBe('string');
      expect(typeof family.familyName).toBe('string');
      expect(Array.isArray(family.variants)).toBe(true);
      for (const v of family.variants) {
        expect(typeof v.id).toBe('string');
        expect(typeof v.variantId).toBe('string');
        expect(typeof v.name).toBe('string');
        expect(['light', 'dark']).toContain(v.mode);
        expect(v.swatch).toEqual({
          bg: expect.any(String),
          fg: expect.any(String),
          accent: expect.any(String),
        });
        // Swatches only -- no CSS block leaks into the gallery data.
        expect(v).not.toHaveProperty('colors');
        expect(v).not.toHaveProperty('css');
      }
    }
  });

  it('includes NON-curated families (nord) that themes.json omits -- the whole gallery', () => {
    runBuild({ THEMES_SOURCE_DIR: OK_FIXTURE });
    const all = JSON.parse(readFileSync(OUT_ALL_JSON, 'utf8'));
    const curated = JSON.parse(readFileSync(OUT_JSON, 'utf8'));

    const allIds = all.families.map((f) => f.familyId).sort();
    // nord is present in the manifest with a colors.json but is NOT a curated
    // family -> it appears in the gallery data, never in the curated themes.json.
    expect(allIds).toContain('nord');
    expect(curated.families.map((f) => f.id)).not.toContain('nord');

    // The curated families are still present in full (all their variants).
    const tokyonight = all.families.find((f) => f.familyId === 'tokyonight');
    const github = all.families.find((f) => f.familyId === 'github');
    expect(tokyonight.variants).toHaveLength(4);
    expect(github.variants).toHaveLength(11);
  });

  it('omits a manifest family lacking colors.json and warns (curated-only fallback)', () => {
    const stdout = runBuild({ THEMES_SOURCE_DIR: OK_FIXTURE });
    const all = JSON.parse(readFileSync(OUT_ALL_JSON, 'utf8'));
    const allIds = all.families.map((f) => f.familyId);

    // dracula is declared in the manifest but has no colors.json on disk (the
    // exact shape of the vendored snapshot, which lists all 17 families but
    // only ships colors.json for the curated 8).
    expect(allIds).not.toContain('dracula');
    expect(stdout).toMatch(/themes-all/);
    expect(stdout).toMatch(/dracula/);
  });
});

describe('build-themes.mjs -- corrupt source with fallback disabled', () => {
  it('exits with code 1 and prints an ::error:: annotation', () => {
    let threw = false;
    try {
      runBuild({ THEMES_SOURCE_DIR: CORRUPT_FIXTURE, THEMES_NO_FALLBACK: '1' });
    } catch (e) {
      threw = true;
      expect(e.status).toBe(1);
      expect(e.stderr).toContain('::error::');
    }
    expect(threw).toBe(true);
  });
});
