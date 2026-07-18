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

beforeAll(() => {
  OUT_DIR = mkdtempSync(join(tmpdir(), 'build-themes-out-'));
  OUT_CSS = join(OUT_DIR, 'src/styles/themes.generated.css');
  OUT_JSON = join(OUT_DIR, 'src/data/generated/themes.json');
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
