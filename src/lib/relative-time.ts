/*
 * relative-time -- the one place a timestamp becomes "3 days ago".
 *
 * The MetadataStrip on every project page shows a repo's last commit as a
 * relative age, computed at BUILD time (the page is static). Pure and
 * dependency-free so it unit-tests without a DOM or Astro; the caller passes
 * `now` in tests for determinism and omits it in real use (defaults to the
 * build clock).
 *
 * Thresholds are coarse on purpose -- a project page never needs "3 weeks" or
 * "yesterday" precision, and coarse buckets read calmer. Months are 30-day
 * approximations and years are 365-day; the numbers are wall-clock decoration,
 * not accounting.
 */

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** "1 minute" / "2 minutes" -- pluralize a unit by its count. */
function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

/**
 * Format a past timestamp as a coarse relative age string. Accepts a Date or an
 * ISO string. Returns null for anything unparseable (so a caller can drop the
 * item from the strip rather than render "NaN months ago"). Future timestamps
 * -- CI clock skew makes a repo's pushedAt read slightly ahead of the build
 * clock -- clamp to "just now" instead of going negative.
 */
export function formatRelativeTime(input: Date | string, now: Date = new Date()): string | null {
  const then = input instanceof Date ? input : new Date(input);
  const t = then.getTime();
  if (Number.isNaN(t)) return null;

  const diff = now.getTime() - t;
  if (diff < MIN) return 'just now';
  if (diff < HOUR) return plural(Math.floor(diff / MIN), 'minute');
  if (diff < DAY) return plural(Math.floor(diff / HOUR), 'hour');
  if (diff < MONTH) return plural(Math.floor(diff / DAY), 'day');
  if (diff < YEAR) return plural(Math.floor(diff / MONTH), 'month');
  return plural(Math.floor(diff / YEAR), 'year');
}
