import { describe, expect, it } from 'vitest';
import { buildThemeDisplayMap, themeDisplayName } from '../src/lib/theme-display';

// A minimal families fixture in the manifest's shape: full ids joined with '-',
// short variantIds that may themselves contain a separator ('_').
const FAMILIES = [
  {
    id: 'tokyonight',
    variants: [
      { id: 'tokyonight-day', variantId: 'day' },
      { id: 'tokyonight-storm', variantId: 'storm' },
    ],
  },
  {
    id: 'github',
    variants: [
      { id: 'github-light_default', variantId: 'light_default' },
      { id: 'github-dark_default', variantId: 'dark_default' },
    ],
  },
];

describe('buildThemeDisplayMap', () => {
  it('maps every full variant id to a "family/variant" label', () => {
    const map = buildThemeDisplayMap(FAMILIES);
    expect(map).toEqual({
      'tokyonight-day': 'tokyonight/day',
      'tokyonight-storm': 'tokyonight/storm',
      'github-light_default': 'github/light_default',
      'github-dark_default': 'github/dark_default',
    });
  });

  it('preserves separators inside a variant id (exact, not a naive split)', () => {
    const map = buildThemeDisplayMap(FAMILIES);
    // "github-dark_default" must resolve family=github, variant=dark_default,
    // never family=github, variant=dark (a first-underscore split would fail).
    expect(map['github-dark_default']).toBe('github/dark_default');
  });

  it('returns an empty map for no families', () => {
    expect(buildThemeDisplayMap([])).toEqual({});
  });
});

describe('themeDisplayName', () => {
  const map = buildThemeDisplayMap(FAMILIES);

  it('uses the exact map when the id is known', () => {
    expect(themeDisplayName('tokyonight-storm', map)).toBe('tokyonight/storm');
    expect(themeDisplayName('github-dark_default', map)).toBe('github/dark_default');
  });

  it('falls back to a first-hyphen split for an unmapped id', () => {
    expect(themeDisplayName('ayu-mirage', map)).toBe('ayu/mirage');
  });

  it('returns an id without a hyphen unchanged', () => {
    expect(themeDisplayName('mystery', map)).toBe('mystery');
  });
});
