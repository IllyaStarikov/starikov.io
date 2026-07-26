import { describe, expect, it } from 'vitest';
import {
  groupByYear,
  filterableTagChips,
  firstTagAccent,
  formatEssayDate,
  essayFreshnessLine,
  type EssayRow,
} from '../src/lib/essays';

function row(slug: string, publishedAt: string): EssayRow {
  return {
    slug,
    title: slug,
    url: `https://starikov.co/${slug}/`,
    publishedAt: new Date(publishedAt),
    readingTime: 5,
    tags: [],
  };
}

describe('groupByYear', () => {
  it('groups rows by UTC published year, years descending', () => {
    const rows = [
      row('a', '2024-03-01T00:00:00.000Z'),
      row('b', '2026-07-14T13:01:17.000Z'),
      row('c', '2025-01-01T00:00:00.000Z'),
    ];
    const groups = groupByYear(rows);
    expect(groups.map((g) => g.year)).toEqual([2026, 2025, 2024]);
  });

  it('sorts rows within a year newest-first regardless of input order', () => {
    const rows = [
      row('older', '2026-01-01T00:00:00.000Z'),
      row('newer', '2026-06-01T00:00:00.000Z'),
      row('newest', '2026-12-01T00:00:00.000Z'),
    ];
    const [group] = groupByYear(rows);
    expect(group.rows.map((r) => r.slug)).toEqual(['newest', 'newer', 'older']);
  });

  it('returns [] for an empty input', () => {
    expect(groupByYear([])).toEqual([]);
  });

  it('a year boundary at UTC midnight groups by the UTC calendar year, not local time', () => {
    // A local timezone that shifts this to the previous/next day is exactly the
    // bug groupByYear must avoid -- UTC-pinning here is deliberate.
    const rows = [row('nye', '2025-12-31T23:30:00.000Z'), row('nyd', '2026-01-01T00:30:00.000Z')];
    const groups = groupByYear(rows);
    expect(groups.map((g) => g.year)).toEqual([2026, 2025]);
  });
});

describe('filterableTagChips', () => {
  const tags = [
    { slug: 'code', name: 'Code', accentColor: '#111', count: 23 },
    { slug: 'travel', name: 'Travel', accentColor: '#222', count: 3 },
    { slug: 'garmin', name: 'Garmin', accentColor: '#333', count: 4 },
    { slug: 'pets', name: 'Pets', accentColor: '#444', count: 2 },
  ];

  it('keeps only tags at or above the minimum count, sorted by count descending', () => {
    const chips = filterableTagChips(tags, 3);
    expect(chips.map((c) => c.slug)).toEqual(['code', 'garmin', 'travel']);
  });

  it('defaults the minimum count to 3', () => {
    const chips = filterableTagChips(tags);
    expect(chips.some((c) => c.slug === 'pets')).toBe(false);
    expect(chips.some((c) => c.slug === 'travel')).toBe(true);
  });

  it('breaks a count tie by name, ascending', () => {
    const tied = [
      { slug: 'b-tag', name: 'Bravo', accentColor: null, count: 5 },
      { slug: 'a-tag', name: 'Alpha', accentColor: null, count: 5 },
    ];
    expect(filterableTagChips(tied, 3).map((c) => c.name)).toEqual(['Alpha', 'Bravo']);
  });

  it('returns [] when nothing meets the threshold', () => {
    expect(filterableTagChips([{ slug: 'x', name: 'X', accentColor: null, count: 1 }], 3)).toEqual(
      [],
    );
  });
});

describe('firstTagAccent', () => {
  const tagBySlug = new Map([
    ['code', { name: 'Code', accentColor: '#7aa2f7' }],
    ['work', { name: 'Work', accentColor: null }],
  ]);

  it("resolves the essay's FIRST tag only, ignoring later tags", () => {
    expect(firstTagAccent(['code', 'work'], tagBySlug)).toEqual({ name: 'Code', accent: '#7aa2f7' });
  });

  it('falls back to var(--accent) when the first tag has no accent color (dot only, never a text color)', () => {
    expect(firstTagAccent(['work'], tagBySlug)).toEqual({ name: 'Work', accent: 'var(--accent)' });
  });

  it('returns null for an essay with no tags', () => {
    expect(firstTagAccent([], tagBySlug)).toBeNull();
  });

  it('returns null when the first tag slug is not in the map (defensive, never throws)', () => {
    expect(firstTagAccent(['ghost-tag'], tagBySlug)).toBeNull();
  });
});

describe('formatEssayDate', () => {
  it('formats as "Mon D, YYYY" in UTC', () => {
    expect(formatEssayDate(new Date('2026-07-14T13:01:17.000Z'))).toBe('Jul 14, 2026');
  });

  it('is pinned to UTC regardless of local runner timezone (near-midnight edge)', () => {
    expect(formatEssayDate(new Date('2026-01-01T00:30:00.000Z'))).toBe('Jan 1, 2026');
  });
});

// v1.1 polish Task 6, A12 -- /writing's honest freshness footer.
describe('essayFreshnessLine', () => {
  it('reports "live from starikov.co · fetched <build time>" when not stale', () => {
    expect(
      essayFreshnessLine({ stale: false, buildStamp: '2026-07-26 22:10 UTC', snapshotDate: '2026-07-18' }),
    ).toBe('essays live from starikov.co · fetched 2026-07-26 22:10 UTC');
  });

  it('reports "index from snapshot · synced <snapshot date>" when stale, NEVER the build stamp', () => {
    const line = essayFreshnessLine({ stale: true, buildStamp: '2026-07-26 22:10 UTC', snapshotDate: '2026-07-18' });
    expect(line).toBe('essay index from snapshot · synced 2026-07-18');
    expect(line).not.toContain('22:10 UTC'); // the stale path must never imply THIS build's freshness
  });
});
