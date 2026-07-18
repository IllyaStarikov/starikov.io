import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from '../src/lib/relative-time';

// A fixed "now" so every case is deterministic regardless of when the suite runs.
const NOW = new Date('2026-07-18T12:00:00Z');

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatRelativeTime', () => {
  it('reports sub-minute gaps as "just now"', () => {
    expect(formatRelativeTime(ago(0), NOW)).toBe('just now');
    expect(formatRelativeTime(ago(45 * SEC), NOW)).toBe('just now');
  });

  it('reports minutes with singular/plural', () => {
    expect(formatRelativeTime(ago(1 * MIN), NOW)).toBe('1 minute ago');
    expect(formatRelativeTime(ago(2 * MIN), NOW)).toBe('2 minutes ago');
    expect(formatRelativeTime(ago(59 * MIN), NOW)).toBe('59 minutes ago');
  });

  it('reports hours with singular/plural', () => {
    expect(formatRelativeTime(ago(1 * HOUR), NOW)).toBe('1 hour ago');
    expect(formatRelativeTime(ago(3 * HOUR), NOW)).toBe('3 hours ago');
    expect(formatRelativeTime(ago(23 * HOUR), NOW)).toBe('23 hours ago');
  });

  it('reports days with singular/plural', () => {
    expect(formatRelativeTime(ago(1 * DAY), NOW)).toBe('1 day ago');
    expect(formatRelativeTime(ago(3 * DAY), NOW)).toBe('3 days ago');
    expect(formatRelativeTime(ago(29 * DAY), NOW)).toBe('29 days ago');
  });

  it('reports months with singular/plural', () => {
    expect(formatRelativeTime(ago(30 * DAY), NOW)).toBe('1 month ago');
    expect(formatRelativeTime(ago(90 * DAY), NOW)).toBe('3 months ago');
    // 335d / 30 = 11 (still < 365d, so months, not a year).
    expect(formatRelativeTime(ago(335 * DAY), NOW)).toBe('11 months ago');
  });

  it('reports years with singular/plural', () => {
    expect(formatRelativeTime(ago(365 * DAY), NOW)).toBe('1 year ago');
    expect(formatRelativeTime(ago(2 * 365 * DAY), NOW)).toBe('2 years ago');
  });

  it('accepts an ISO string as well as a Date', () => {
    expect(formatRelativeTime(ago(3 * DAY).toISOString(), NOW)).toBe('3 days ago');
  });

  it('never emits a negative future value; clamps to "just now"', () => {
    // A pushedAt that is (slightly) ahead of the build clock must not read
    // "-1 minutes ago". Clock skew is real on CI.
    expect(formatRelativeTime(new Date(NOW.getTime() + 5 * MIN), NOW)).toBe('just now');
  });

  it('returns null for an unparseable input rather than "NaN ... ago"', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBeNull();
  });
});
