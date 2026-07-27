/*
 * dates -- the ONE user-facing date formatter (v1.1 polish Task 7). Before
 * this module existed the site had five-plus near-duplicate date formats:
 * essays.ts's own Intl.DateTimeFormat ("Jul 14, 2026"), a second, UNPINNED
 * `toLocaleDateString` in bin/[tool].astro (a real bug -- a date-only ISO
 * string like "2025-09-05" parses as UTC midnight, so formatting it in the
 * BUILD MACHINE's local zone could print the wrong calendar day anywhere
 * west of UTC), changelog.astro's own month/day breakdown, plus assorted
 * ISO stamps. This is now the one place a calendar date becomes prose.
 *
 * Deliberately NOT the whole story -- three other date surfaces stay exactly
 * as they were, on purpose, not because they were missed:
 *   - `<time datetime>` machine attributes stay ISO (that's the whole point
 *     of the attribute: a value assistive tech / crawlers can parse).
 *   - Build-provenance lines (colophon's "built", SystemCard's "built",
 *     ProvenanceFooter's sync line, /writing's freshness footer) stay
 *     "YYYY-MM-DD HH:MM UTC" -- terminal-flavored disclosures where the
 *     ISO/UTC stamp IS the point, not a reading date.
 *   - Relative ages ("3 days ago") stay on relative-time.ts, a different
 *     axis entirely (elapsed time, not a calendar date).
 *
 * UTC-pinned like essays.ts's date grouping already was: a build must print
 * the same calendar day everywhere regardless of which timezone the CI
 * runner or a developer's laptop happens to be in.
 */

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "Jul 14, 2026" -- the one user-facing date format on the site. PURE. */
export function formatDate(date: Date): string {
  return DATE_FORMAT.format(date);
}
