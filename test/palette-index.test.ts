import { describe, expect, it } from 'vitest';
import { buildPaletteIndex, buildThemeEntries, MAX_TAGLINE } from '../src/lib/palette-index';
import type { SiteItem } from '../src/lib/model';

/*
 * The palette index endpoint (src/pages/palette-index.json.ts) is a thin async
 * wrapper that fetches collections and hands them to these pure builders. The
 * builders are what carry the contract -- {items, themes, version} with themes
 * reduced to {family, name, dark, light} accent hexes -- so they are what the
 * shape test drives, with plain fixtures and no Astro runtime.
 */

const ITEMS: SiteItem[] = [
  { type: 'tool', slug: 'pocketcasts-reset', title: 'pocketcasts-reset', tagline: 'Reset subscriptions', href: '/bin/pocketcasts-reset', date: '2026-06-01' },
  { type: 'essay', slug: 'why-vim', title: 'Why Vim', tagline: 'An essay', href: 'https://starikov.co/why-vim', date: '2026-05-01' },
];

const FAMILIES = [
  {
    id: 'tokyonight',
    name: 'Tokyo Night',
    pair: { light: 'tokyonight-day', dark: 'tokyonight-storm' },
    variants: [
      { id: 'tokyonight-day', swatch: { bg: '#e1e2e7', fg: '#3760bf', accent: '#2e7de9' } },
      { id: 'tokyonight-storm', swatch: { bg: '#24283b', fg: '#c0caf5', accent: '#7aa2f7' } },
    ],
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    pair: { light: 'catppuccin-latte', dark: 'catppuccin-mocha' },
    variants: [
      { id: 'catppuccin-latte', swatch: { bg: '#eff1f5', fg: '#4c4f69', accent: '#1e66f5' } },
      { id: 'catppuccin-mocha', swatch: { bg: '#1e1e2e', fg: '#cdd6f4', accent: '#89b4fa' } },
    ],
  },
];

describe('buildThemeEntries', () => {
  it('reduces each family to {family, name, dark, light} accent hexes', () => {
    const entries = buildThemeEntries(FAMILIES);
    expect(entries).toEqual([
      { family: 'tokyonight', name: 'Tokyo Night', dark: '#7aa2f7', light: '#2e7de9' },
      { family: 'catppuccin', name: 'Catppuccin', dark: '#89b4fa', light: '#1e66f5' },
    ]);
  });

  it('keeps one entry per curated family, in manifest order', () => {
    const entries = buildThemeEntries(FAMILIES);
    expect(entries.map((e) => e.family)).toEqual(['tokyonight', 'catppuccin']);
  });
});

describe('buildPaletteIndex', () => {
  it('produces the {items, themes, version} contract', () => {
    const index = buildPaletteIndex(ITEMS, FAMILIES, '2026-07-18');
    expect(index.version).toBe('2026-07-18');
    expect(index.items).toHaveLength(ITEMS.length);
    expect(index.items[0].slug).toBe('pocketcasts-reset');
    expect(index.themes).toHaveLength(2);
    expect(index.themes[0]).toEqual({
      family: 'tokyonight',
      name: 'Tokyo Night',
      dark: '#7aa2f7',
      light: '#2e7de9',
    });
  });

  it('projects items to the palette shape: drops date, keeps the rest', () => {
    const index = buildPaletteIndex(ITEMS, FAMILIES, 'v');
    const tool = index.items[0];
    expect(tool).toMatchObject({
      type: 'tool',
      slug: 'pocketcasts-reset',
      title: 'pocketcasts-reset',
      href: '/bin/pocketcasts-reset',
    });
    expect('date' in tool).toBe(false);
  });

  it('trims an over-long tagline to a single-line preview with an ellipsis', () => {
    const long = 'x'.repeat(400);
    const index = buildPaletteIndex(
      [{ type: 'essay', slug: 'e', title: 'E', tagline: long, href: 'https://x', date: '2026-01-01' }],
      FAMILIES,
      'v',
    );
    expect(index.items[0].tagline.length).toBeLessThanOrEqual(MAX_TAGLINE);
    expect(index.items[0].tagline.endsWith('…')).toBe(true);
  });

  it('serializes to JSON round-trippable by the client', () => {
    const index = buildPaletteIndex(ITEMS, FAMILIES, 'v');
    const round = JSON.parse(JSON.stringify(index));
    expect(round.items[0].slug).toBe('pocketcasts-reset');
    expect(round.themes[1].name).toBe('Catppuccin');
  });
});
