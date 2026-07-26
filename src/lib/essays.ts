/*
 * essays -- pure logic for /writing and the home page's essay rows. No
 * `astro:content` import here (Astro-free, unlike `model.ts`), same "testable
 * pure core" split as `src/lib/projects.ts`: the Astro-facing pages import
 * these functions and supply plain data pulled from the `essays`/`essayTags`
 * collections.
 *
 * Dates are treated as UTC throughout (`getUTCFullYear`, `timeZone: 'UTC'` on
 * the formatter) so year-grouping and the printed date are stable regardless
 * of the machine building the site -- a post published at
 * `2026-01-01T00:30:00Z` must group into 2026 whether the CI runner or a
 * developer's laptop is behind UTC.
 */

/** The shape /writing's ledger rows and the home essay rows need. */
export interface EssayRow {
  slug: string;
  title: string;
  url: string;
  publishedAt: Date;
  readingTime: number;
  /** Tag slugs, in Ghost's order (index 0 drives the row's dot color). */
  tags: string[];
}

export interface YearGroup {
  year: number;
  rows: EssayRow[];
}

/**
 * Group essay rows by their UTC published year, newest year first; rows within
 * a year are newest-first too. Input order doesn't matter -- both levels are
 * sorted here, not assumed pre-sorted. PURE.
 */
export function groupByYear(rows: EssayRow[]): YearGroup[] {
  const byYear = new Map<number, EssayRow[]>();
  for (const row of rows) {
    const year = row.publishedAt.getUTCFullYear();
    const bucket = byYear.get(year);
    if (bucket) bucket.push(row);
    else byYear.set(year, [row]);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, groupRows]) => ({
      year,
      rows: [...groupRows].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()),
    }));
}

/** The slice of an `essayTags` entry the tag-chip / dot logic below needs. */
export interface EssayTagRef {
  slug: string;
  name: string;
  accentColor: string | null;
  count: number;
}

export interface TagChip {
  slug: string;
  name: string;
  count: number;
}

/**
 * The /writing filter chips: only tags with at least `minCount` essays (design
 * spec: "count >= 3"), sorted by count descending, ties broken alphabetically
 * so the row is deterministic across builds. PURE.
 */
export function filterableTagChips(tags: EssayTagRef[], minCount = 3): TagChip[] {
  return tags
    .filter((t) => t.count >= minCount)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .map(({ slug, name, count }) => ({ slug, name, count }));
}

export interface TagDot {
  name: string;
  /** A CSS color -- either the tag's Ghost accent_color or the `var(--accent)`
   *  fallback when Ghost has none set. Consumers use this ONLY for the 8px dot
   *  background, never as a text color (design spec: blend-safety). */
  accent: string;
}

/**
 * Resolve an essay's row dot: the FIRST tag only (design spec), looked up by
 * exact slug against the `essayTags` map -- no fuzzy matching. Returns null
 * for an untagged essay or a first tag the map doesn't recognize (a build
 * with a stale/incomplete essayTags collection should render an untagged row,
 * not throw). PURE.
 */
export function firstTagAccent(
  tags: string[],
  tagBySlug: Map<string, { name: string; accentColor: string | null }>,
): TagDot | null {
  const slug = tags[0];
  if (!slug) return null;
  const tag = tagBySlug.get(slug);
  if (!tag) return null;
  return { name: tag.name, accent: tag.accentColor ?? 'var(--accent)' };
}

const ESSAY_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "Jul 14, 2026" -- the /writing ledger row's date column. PURE. */
export function formatEssayDate(date: Date): string {
  return ESSAY_DATE_FORMAT.format(date);
}

export interface EssayFreshnessInput {
  /** True when THIS build's shared Ghost fetch (src/loaders/ghost.ts) did
   *  NOT come from a successful live call -- `essays[0].data.stale`, one
   *  shared fetch per build so any entry's flag speaks for all of them. */
  stale: boolean;
  /** This build's own timestamp, pre-formatted "YYYY-MM-DD HH:MM UTC" --
   *  supplied by the caller (not read from `new Date()` here) so this stays a
   *  pure function of its inputs. */
  buildStamp: string;
  /** The committed vendor snapshot's own provenance date ("YYYY-MM-DD"), from
   *  src/data/vendor/ghost-snapshot-meta.json (derived via `git log` on
   *  ghost-snapshot.json -- an honest historical date, never "now"). */
  snapshotDate: string;
}

/**
 * /writing's freshness disclosure (v1.1 polish Task 6, A12; ProvenanceFooter's
 * pattern applied to a collection instead of one overlay+repo): "essays live
 * from starikov.co · fetched <build time>" when this build's shared Ghost
 * fetch was live, else "essay index from snapshot · synced <date>" -- cache
 * and vendor fallback tiers both collapse to the one "snapshot" bucket, same
 * as ProvenanceFooter's own `stale` (a stale cache result is not "live from
 * starikov.co" either, and the codebase has no finer-grained provenance for
 * a cache-tier hit than "not live this build"). PURE.
 */
export function essayFreshnessLine({ stale, buildStamp, snapshotDate }: EssayFreshnessInput): string {
  return stale
    ? `essay index from snapshot · synced ${snapshotDate}`
    : `essays live from starikov.co · fetched ${buildStamp}`;
}
