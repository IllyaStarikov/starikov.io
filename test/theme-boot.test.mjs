import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { BG, DEFAULTS, PAIRS, THEME_BOOT_SRC, buildBootSrc } from '../src/lib/theme-boot.ts';

/*
 * Exact-value resolver assertions run against a FIXED fixture fed through the
 * pure buildBootSrc(), not the real themes.json. themes.json is gitignored and
 * regenerated every build, and a sibling suite (build-themes.test.mjs) rewrites
 * it to a two-family fixture as a side effect -- so baking exact expectations
 * off its live contents would be order-dependent and flaky. The fixture mirrors
 * production data, so the brief's literal cases (tokyonight-storm,
 * catppuccin-latte, unknown -> default) are still asserted verbatim. The real
 * THEME_BOOT_SRC is exercised separately with self-consistent expectations.
 */
const FIXTURE_PAIRS = {
  tokyonight: { light: 'day', dark: 'storm' },
  catppuccin: { light: 'latte', dark: 'mocha' },
};
const FIXTURE_DEFAULTS = { family: 'tokyonight' };
const FIXTURE_BG = {
  'tokyonight-day': '#e1e2e7',
  'tokyonight-storm': '#24283b',
  'catppuccin-latte': '#eff1f5',
  'catppuccin-mocha': '#1e1e2e',
};
const FIXTURE_SRC = buildBootSrc(FIXTURE_PAIRS, FIXTURE_DEFAULTS, FIXTURE_BG);

/**
 * Evaluate a boot IIFE string inside a linkedom document with stubbed
 * matchMedia/localStorage -- the globals the script reaches for in a browser.
 * Returns handles the tests use to drive it.
 */
function bootEnv({ sysDark = false, storage = {}, src = FIXTURE_SRC } = {}) {
  const { window, document } = parseHTML(
    '<!doctype html><html><head><meta name="theme-color" content=""></head><body></body></html>',
  );

  const state = { sysDark };
  const changeListeners = [];

  function matchMedia(query) {
    const reducedMotion = /prefers-reduced-motion/.test(query);
    return {
      media: query,
      get matches() {
        return reducedMotion ? false : state.sysDark;
      },
      addEventListener(type, cb) {
        if (type === 'change') changeListeners.push(cb);
      },
      removeEventListener() {},
      addListener(cb) {
        changeListeners.push(cb);
      },
      removeListener() {},
    };
  }

  const localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
    setItem: (k, v) => {
      storage[k] = String(v);
    },
    removeItem: (k) => {
      delete storage[k];
    },
  };

  window.matchMedia = matchMedia;
  window.localStorage = localStorage;

  // linkedom shares ONE window object across every parseHTML() call (only the
  // documents differ). The boot script guards listener registration with
  // `window.__themeBooted` so ClientRouter swaps never stack duplicates -- but
  // that flag would leak between tests here. Reset the shared globals so each
  // scenario registers its listeners against its own fresh document, mirroring
  // a real first page load.
  window.__themeBooted = undefined;
  window.__applyTheme = undefined;

  // Run the IIFE with the globals it reads bound to our fakes.
  // eslint-disable-next-line no-new-func
  const run = new Function('window', 'document', 'matchMedia', 'localStorage', src);
  run(window, document, matchMedia, localStorage);

  return {
    window,
    document,
    themeAttr: () => document.documentElement.getAttribute('data-theme'),
    themeColor: () => document.querySelector('meta[name="theme-color"]').getAttribute('content'),
    fireColorSchemeChange(dark) {
      state.sysDark = dark;
      changeListeners.forEach((cb) => cb({ matches: dark }));
    },
    afterSwap() {
      document.dispatchEvent(new window.Event('astro:after-swap'));
    },
  };
}

describe('resolver (the three required cases)', () => {
  it('no storage under dark system -> tokyonight-storm', () => {
    const env = bootEnv({ sysDark: true, storage: {} });
    expect(env.themeAttr()).toBe('tokyonight-storm');
  });

  it('no storage under light system -> tokyonight-day', () => {
    const env = bootEnv({ sysDark: false, storage: {} });
    expect(env.themeAttr()).toBe('tokyonight-day');
  });

  it('family=catppuccin, mode=light -> catppuccin-latte', () => {
    const env = bootEnv({
      sysDark: true,
      storage: { 'theme:family': 'catppuccin', 'theme:mode': 'light' },
    });
    expect(env.themeAttr()).toBe('catppuccin-latte');
  });

  it('unknown family falls back to the default family', () => {
    const env = bootEnv({
      sysDark: true,
      storage: { 'theme:family': 'not-a-real-family', 'theme:mode': 'dark' },
    });
    expect(env.themeAttr()).toBe('tokyonight-storm');
  });
});

describe('theme-color meta', () => {
  it('is set to the resolved theme bg pre-paint (deterministic, no getComputedStyle)', () => {
    const env = bootEnv({
      sysDark: false,
      storage: { 'theme:family': 'catppuccin', 'theme:mode': 'light' },
    });
    expect(env.themeAttr()).toBe('catppuccin-latte');
    expect(env.themeColor()).toBe('#eff1f5');
  });
});

describe('ClientRouter survival: astro:after-swap re-application', () => {
  it('re-applies the correct theme after a swap wiped/changed the attribute', () => {
    const env = bootEnv({
      sysDark: true,
      storage: { 'theme:family': 'catppuccin', 'theme:mode': 'dark' },
    });
    expect(env.themeAttr()).toBe('catppuccin-mocha');

    // Simulate a navigation swapping in a document with the wrong attribute.
    env.document.documentElement.setAttribute('data-theme', 'WRONG-VALUE');
    env.afterSwap();

    expect(env.themeAttr()).toBe('catppuccin-mocha');
    expect(env.themeColor()).toBe('#1e1e2e');
  });
});

describe('system-mode live switch via matchMedia change', () => {
  it('flips light<->dark when the OS scheme changes and mode is system', () => {
    const env = bootEnv({ sysDark: false, storage: {} });
    expect(env.themeAttr()).toBe('tokyonight-day');

    env.fireColorSchemeChange(true);
    expect(env.themeAttr()).toBe('tokyonight-storm');

    env.fireColorSchemeChange(false);
    expect(env.themeAttr()).toBe('tokyonight-day');
  });

  it('ignores the OS scheme change when an explicit mode is stored', () => {
    const env = bootEnv({
      sysDark: false,
      storage: { 'theme:family': 'tokyonight', 'theme:mode': 'light' },
    });
    expect(env.themeAttr()).toBe('tokyonight-day');

    env.fireColorSchemeChange(true); // OS goes dark, but mode is explicitly light
    expect(env.themeAttr()).toBe('tokyonight-day');
  });
});

describe('buildBootSrc is a pure function of its inputs', () => {
  it('produces a resolver honoring an injected pairs/defaults/bg map', () => {
    const src = buildBootSrc(
      { onlyfam: { light: 'l', dark: 'd' } },
      { family: 'onlyfam' },
      { 'onlyfam-d': '#000000', 'onlyfam-l': '#ffffff' },
    );
    const env = bootEnv({ sysDark: true, storage: {}, src });
    expect(env.themeAttr()).toBe('onlyfam-d');
    expect(env.themeColor()).toBe('#000000');
  });
});

/*
 * Real THEME_BOOT_SRC (embeds whatever themes.json is on disk). Assertions are
 * self-consistent -- derived from the same exported PAIRS/DEFAULTS/BG the string
 * was built from -- so they hold no matter which families the current
 * themes.json contains.
 */
describe('real THEME_BOOT_SRC + embedded data', () => {
  it('exports a well-formed default family with a light+dark pair', () => {
    expect(typeof DEFAULTS.family).toBe('string');
    expect(DEFAULTS.family.length).toBeGreaterThan(0);
    expect(PAIRS[DEFAULTS.family]).toBeTruthy();
    expect(typeof PAIRS[DEFAULTS.family].light).toBe('string');
    expect(typeof PAIRS[DEFAULTS.family].dark).toBe('string');
  });

  it('BG maps the default dark theme id to a hex color', () => {
    const id = `${DEFAULTS.family}-${PAIRS[DEFAULTS.family].dark}`;
    expect(BG[id]).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('resolves the default family + bg under dark system (self-consistent)', () => {
    const env = bootEnv({ sysDark: true, storage: {}, src: THEME_BOOT_SRC });
    const expectedId = `${DEFAULTS.family}-${PAIRS[DEFAULTS.family].dark}`;
    expect(env.themeAttr()).toBe(expectedId);
    expect(env.themeColor()).toBe(BG[expectedId]);
  });

  // When the full curated manifest is present, verify the real string yields the
  // brief's literal. Skipped only if a sibling suite has swapped themes.json for
  // its reduced fixture -- keeping the run green without weakening intent.
  it.skipIf(!PAIRS.catppuccin)(
    'real string resolves catppuccin/light -> catppuccin-latte',
    () => {
      const env = bootEnv({
        sysDark: true,
        storage: { 'theme:family': 'catppuccin', 'theme:mode': 'light' },
        src: THEME_BOOT_SRC,
      });
      expect(env.themeAttr()).toBe('catppuccin-latte');
    },
  );
});
