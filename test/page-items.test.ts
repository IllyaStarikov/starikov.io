import { describe, expect, it } from 'vitest';
import { PAGE_ITEMS } from '../src/lib/page-items';
import { selectRecentItems } from '../src/lib/recent';
import { buildFeedItems } from '../src/lib/feed';
import { buildPaletteIndex } from '../src/lib/palette-index';
import type { SiteItem } from '../src/lib/model';

/*
 * PAGE_ITEMS (v1.1 polish Task 5, design spec §3 obligation A3): every
 * first-class static route -- home, about, colophon, changelog, writing, bin,
 * projects, academia -- as a SiteItem, so ⌘K "Jump to" (which reads the
 * palette index unfiltered) reaches the whole site, not just /academia.
 *
 * The ripple: every OTHER consumer of getAllItems() filters on `item.date`
 * (selectRecentItems, changelog.astro's `.filter((i) => i.date)`) or sorts
 * undated items last and never reaches the top of a capped slice
 * (buildFeedItems / rss.xml -- the site has 94+ dated essays alone, so a
 * static page can never displace one from the top 50). These tests pin both
 * directions: pages never leak into a dated surface, and the palette index
 * (the intended consumer) carries every one of them.
 */
const ROUTES = ['/', '/about', '/colophon', '/changelog', '/writing', '/bin', '/projects', '/academia'];

describe('PAGE_ITEMS', () => {
  it('covers every first-class static route exactly once', () => {
    expect(PAGE_ITEMS.map((i) => i.href).sort()).toEqual([...ROUTES].sort());
  });

  it('every entry is type "page" with a non-empty title, tagline, and site-local href', () => {
    for (const item of PAGE_ITEMS) {
      expect(item.type).toBe('page');
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.tagline.length).toBeGreaterThan(0);
      expect(item.href.startsWith('/')).toBe(true);
    }
  });

  it('is never dated -- pages are standing content, not dated posts', () => {
    for (const item of PAGE_ITEMS) {
      expect(item.date).toBeUndefined();
    }
  });

  it('the 7 newly-added taglines fit the palette single-line preview with no truncation (palette-index.ts MAX_TAGLINE=72)', () => {
    // 'academia' pre-dates this budget by 2 chars (already the pre-existing
    // tagline, also duplicated verbatim in index.astro's START HERE card) --
    // out of this task's scope to retouch, so it's excluded here rather than
    // silently loosening the bar for the new entries.
    for (const item of PAGE_ITEMS) {
      if (item.slug === 'academia') continue;
      expect(item.tagline.length).toBeLessThanOrEqual(72);
    }
  });

  it('slugs are unique', () => {
    const slugs = PAGE_ITEMS.map((i) => i.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('PAGE_ITEMS ripple: dated surfaces never show a page item', () => {
  it('selectRecentItems (home RECENTLY UPDATED) drops every page item, undated + type both exclude them', () => {
    const result = selectRecentItems(PAGE_ITEMS, new Set(), 999);
    expect(result).toHaveLength(0);
  });

  it('changelog.astro-style date filter (`.filter((i) => i.date)`) removes every page item', () => {
    const filtered = PAGE_ITEMS.filter((i) => i.date);
    expect(filtered).toHaveLength(0);
  });

  it('buildFeedItems (rss.xml + changelog data source) carries page items with no pubDate, sorted after dated items', () => {
    const dated: SiteItem = {
      type: 'tool',
      slug: 'x',
      title: 'X',
      tagline: 'x',
      href: '/bin/x',
      date: '2026-01-01T00:00:00.000Z',
    };
    const items = buildFeedItems([dated, ...PAGE_ITEMS], 'https://starikov.io', 999);
    expect(items[0].link).toBe('https://starikov.io/bin/x');
    for (const item of items.slice(1)) expect(item.pubDate).toBeUndefined();
  });

  it('a capped feed slice (the real rss.xml/changelog shape) never admits a page item once dated items fill the cap', () => {
    // Mirrors production: 94+ dated essays alone outnumber the 50-item RSS
    // cap, so undated pages (sorted last, always) never reach the slice.
    const manyDated: SiteItem[] = Array.from({ length: 60 }, (_, i) => ({
      type: 'essay',
      slug: `e${i}`,
      title: `Essay ${i}`,
      tagline: 'x',
      href: `https://starikov.co/e${i}`,
      date: new Date(2026, 0, i + 1).toISOString(),
    }));
    const items = buildFeedItems([...manyDated, ...PAGE_ITEMS], 'https://starikov.io', 50);
    expect(items).toHaveLength(50);
    expect(items.every((i) => i.pubDate !== undefined)).toBe(true);
  });
});

describe('PAGE_ITEMS ripple: the palette index carries every page, unfiltered', () => {
  it('buildPaletteIndex includes all 8 routes in the "Jump to" pool (every non-essay item)', () => {
    const index = buildPaletteIndex(PAGE_ITEMS, [], 'v');
    expect(index.items.map((i) => i.href).sort()).toEqual([...ROUTES].sort());
    for (const item of index.items) expect(item.type).toBe('page');
  });
});
