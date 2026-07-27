import { describe, expect, it } from 'vitest';
// Imported from the Astro-free pure core (model.ts re-exports this, but pulls
// in `astro:content`, which doesn't resolve under vitest). Same function.
import { selectRecentItems } from '../src/lib/recent';
import type { SiteItem } from '../src/lib/model';

function item(over: Partial<SiteItem> & Pick<SiteItem, 'slug' | 'href'>): SiteItem {
  return {
    type: 'tool',
    title: `Title: ${over.slug}`,
    tagline: `Tagline for ${over.slug}.`,
    date: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('selectRecentItems', () => {
  it('excludes essays (they own LATEST ESSAYS below)', () => {
    const items = [
      item({ slug: 'an-essay', href: 'https://starikov.co/an-essay/', type: 'essay' }),
      item({ slug: 'a-tool', href: '/bin/a-tool', type: 'tool' }),
    ];
    const result = selectRecentItems(items, new Set());
    expect(result.map((i) => i.slug)).toEqual(['a-tool']);
  });

  it('excludes hrefs already curated in START HERE, unconditionally', () => {
    const items = [
      item({ slug: 'dotfiles', href: '/projects/dotfiles', date: '2026-07-20T00:00:00.000Z' }),
      item({ slug: 'a-tool', href: '/bin/a-tool', date: '2026-07-10T00:00:00.000Z' }),
    ];
    const result = selectRecentItems(items, new Set(['/projects/dotfiles']));
    expect(result.map((i) => i.slug)).toEqual(['a-tool']);
  });

  it('drops undated items (e.g. static pages with no `date`)', () => {
    const items = [
      item({ slug: 'academia', href: '/academia', date: undefined, type: 'page' }),
      item({ slug: 'a-tool', href: '/bin/a-tool' }),
    ];
    const result = selectRecentItems(items, new Set());
    expect(result.map((i) => i.slug)).toEqual(['a-tool']);
  });

  it('caps at 5 by default', () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      item({
        slug: `item-${i}`,
        href: `/bin/item-${i}`,
        date: new Date(2026, 0, i + 1).toISOString(),
      }),
    );
    const result = selectRecentItems(items, new Set());
    expect(result).toHaveLength(5);
  });

  it('accepts a custom cap', () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      item({
        slug: `item-${i}`,
        href: `/bin/item-${i}`,
        date: new Date(2026, 0, i + 1).toISOString(),
      }),
    );
    const result = selectRecentItems(items, new Set(), 2);
    expect(result).toHaveLength(2);
  });

  it('is newest-first regardless of input order (date-sorted, not trusting caller order)', () => {
    // Deliberately NOT in date order, matching test/related.test.ts's convention
    // of catching a bug that would trust array order instead of sorting.
    const items = [
      item({ slug: 'oldest', href: '/bin/oldest', date: '2020-01-01T00:00:00.000Z' }),
      item({ slug: 'newest', href: '/bin/newest', date: '2026-07-20T00:00:00.000Z' }),
      item({ slug: 'middle', href: '/bin/middle', date: '2026-03-01T00:00:00.000Z' }),
    ];
    const result = selectRecentItems(items, new Set());
    expect(result.map((i) => i.slug)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('combines every rule: essays and curated hrefs excluded, capped, date-sorted -- AND actually exercises the cap trim (7 qualifying items in, only the newest 5 survive)', () => {
    const items = [
      item({ slug: 'essay-1', href: 'https://starikov.co/essay-1/', type: 'essay', date: '2026-07-25T00:00:00.000Z' }),
      item({ slug: 'dotfiles', href: '/projects/dotfiles', type: 'project', date: '2026-07-24T00:00:00.000Z' }),
      item({ slug: 'tool-a', href: '/bin/tool-a', date: '2026-07-01T00:00:00.000Z' }),
      item({ slug: 'tool-b', href: '/bin/tool-b', date: '2026-07-10T00:00:00.000Z' }),
      item({ slug: 'tool-c', href: '/bin/tool-c', date: '2026-06-01T00:00:00.000Z' }),
      item({ slug: 'tool-d', href: '/bin/tool-d', date: '2026-05-01T00:00:00.000Z' }),
      item({ slug: 'tool-e', href: '/bin/tool-e', date: '2026-04-01T00:00:00.000Z' }),
      // Two MORE qualifying (dated, non-essay, non-excluded) items, older than
      // every item above: without these, tool-a..e alone are exactly 5 --
      // the default cap -- so slice(0, 5) never actually cuts anything, and a
      // broken/absent cap would pass this test just as well as a correct one
      // (Task 3 review finding). tool-f/tool-g push the qualifying count to 7
      // so the assertion below only holds if the trim genuinely drops the two
      // oldest, not merely if the sort is right.
      item({ slug: 'tool-f', href: '/bin/tool-f', date: '2026-03-01T00:00:00.000Z' }),
      item({ slug: 'tool-g', href: '/bin/tool-g', date: '2026-02-01T00:00:00.000Z' }),
      item({ slug: 'academia', href: '/academia', type: 'page', date: undefined }),
    ];
    const startHereHrefs = new Set(['/projects/dotfiles', '/academia']);
    const result = selectRecentItems(items, startHereHrefs);
    expect(result).toHaveLength(5);
    expect(result.map((i) => i.slug)).toEqual([
      'tool-b',
      'tool-a',
      'tool-c',
      'tool-d',
      'tool-e',
    ]);
    // Explicit, not just implied by the exact-array-equality above: the two
    // oldest qualifying items must not survive the cap.
    expect(result.map((i) => i.slug)).not.toContain('tool-f');
    expect(result.map((i) => i.slug)).not.toContain('tool-g');
  });
});
