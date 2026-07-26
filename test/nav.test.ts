import { describe, expect, it } from 'vitest';
import { SLICE_LIMIT, sliceGroup, type NavGroup } from '../src/lib/nav';

/*
 * sliceGroup has two independent concerns that used to be entangled:
 *   1. slicing -- pass items through untouched at/under SLICE_LIMIT (8),
 *      sort-and-cut above it.
 *   2. the index link -- present whenever `group.index` is declared, at ANY
 *      item count. Before this fix it only appeared when items.length === 0
 *      (a separate branch in Sidebar.astro) or > SLICE_LIMIT (the old
 *      `overflow` field) -- so a group with 1-8 items and a declared index
 *      (e.g. Tools with a handful of entries) had no way back to its landing
 *      page. These tests pin both concerns at the three item-count states
 *      (backlog #12).
 */

function itemsOfLength(n: number): NavGroup['items'] {
  return Array.from({ length: n }, (_, i) => ({
    href: `/bin/tool-${i}`,
    label: `Tool ${i}`,
    // Distinct, non-chronological `updated` dates so a >8 test can assert a
    // real reorder, not an accidental pass-through.
    updated: `2026-01-${String((i % 27) + 1).padStart(2, '0')}`,
  }));
}

describe('sliceGroup: <8 items', () => {
  const group: NavGroup = { label: 'Tools', index: { href: '/bin' }, items: itemsOfLength(3) };

  it('passes items through untouched, in declared order', () => {
    const { items } = sliceGroup(group);
    expect(items).toEqual(group.items);
  });

  it('always attaches the index link when the group declares one', () => {
    const { indexLink } = sliceGroup(group);
    expect(indexLink).toEqual({ href: '/bin', label: 'All tools →' });
  });

  it('omits the index link entirely when the group has none', () => {
    const noIndex: NavGroup = { label: 'Academia', items: itemsOfLength(2) };
    expect(sliceGroup(noIndex).indexLink).toBeUndefined();
  });

  it('handles zero items the same way (the old empty-group special case)', () => {
    const empty: NavGroup = { label: 'Tools', index: { href: '/bin' }, items: [] };
    const { items, indexLink } = sliceGroup(empty);
    expect(items).toEqual([]);
    expect(indexLink).toEqual({ href: '/bin', label: 'All tools →' });
  });
});

describe('sliceGroup: =8 items (the SLICE_LIMIT boundary)', () => {
  const group: NavGroup = {
    label: 'Projects',
    index: { href: '/projects' },
    items: itemsOfLength(SLICE_LIMIT),
  };

  it('passes all 8 through untouched -- the boundary is inclusive, not sliced', () => {
    const { items } = sliceGroup(group);
    expect(items).toHaveLength(SLICE_LIMIT);
    expect(items).toEqual(group.items);
  });

  it('still always renders the index link exactly at the boundary', () => {
    expect(sliceGroup(group).indexLink).toEqual({ href: '/projects', label: 'All projects →' });
  });
});

describe('sliceGroup: >8 items (the slice/overflow case)', () => {
  const group: NavGroup = {
    label: 'Tools',
    index: { href: '/bin' },
    items: itemsOfLength(12),
  };

  it('sorts by `updated` desc and cuts to SLICE_LIMIT', () => {
    const { items } = sliceGroup(group);
    expect(items).toHaveLength(SLICE_LIMIT);
    const updatedDates = items.map((i) => i.updated);
    expect(updatedDates).toEqual([...updatedDates].sort((a, b) => (b ?? '').localeCompare(a ?? '')));
  });

  it('still attaches the index link, in the same "All <label> ->" shape as the other states', () => {
    // Not "All 12 ->" -- the count-style overflow label is gone; every state
    // now shares one label format regardless of how much slicing happened.
    expect(sliceGroup(group).indexLink).toEqual({ href: '/bin', label: 'All tools →' });
  });

  it('omits the index link above the limit too when the group has none', () => {
    const noIndex: NavGroup = { label: 'Academia', items: itemsOfLength(9) };
    expect(sliceGroup(noIndex).indexLink).toBeUndefined();
  });
});
