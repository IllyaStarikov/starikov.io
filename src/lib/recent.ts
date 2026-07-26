/*
 * recent -- pure core for the home page's RECENTLY UPDATED ledger (design
 * spec §3, v1.1 polish Task 3): the newest DATED, non-essay items, excluding
 * any href already curated in START HERE above (essays own LATEST ESSAYS
 * below; curated START HERE rows already show their own `updated` meta --
 * this exclusion is unconditional, not a "top N minus overlap" heuristic).
 *
 * Astro-free by construction -- only an `import type` of `SiteItem` from
 * `./model` (erased at compile time, so `astro:content` is never touched) --
 * so `test/recent.test.ts` runs it under plain vitest with hand-built
 * SiteItem objects. Same "testable pure core" split as `src/lib/projects.ts`
 * and `src/lib/related.ts`'s `resolveRelatedEssaysCore`. Re-exported from
 * `model.ts` for one public home, same as those.
 */
import type { SiteItem } from './model';

const RECENT_LIMIT = 5;

/**
 * Dated, non-essay items whose `href` isn't already curated (`excludeHrefs`),
 * newest-first, capped at `limit` (default 5). Sorts by date descending
 * itself -- same tie-break style as `getAllItems` -- rather than trusting the
 * caller's order, so the result is date-sorted even if `items` isn't.
 */
export function selectRecentItems(
  items: SiteItem[],
  excludeHrefs: ReadonlySet<string>,
  limit = RECENT_LIMIT,
): SiteItem[] {
  return items
    .filter((item) => Boolean(item.date) && item.type !== 'essay' && !excludeHrefs.has(item.href))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .slice(0, limit);
}
