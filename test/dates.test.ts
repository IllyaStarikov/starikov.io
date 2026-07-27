import { describe, expect, it } from 'vitest';
import { formatDate } from '../src/lib/dates';

// Moved from essays.test.ts (v1.1 polish Task 7): formatEssayDate's own
// Intl.DateTimeFormat moved here verbatim as the site's one date formatter,
// so its two original pins move with it.
describe('formatDate', () => {
  it('formats as "Mon D, YYYY" in UTC', () => {
    expect(formatDate(new Date('2026-07-14T13:01:17.000Z'))).toBe('Jul 14, 2026');
  });

  it('is pinned to UTC regardless of local runner timezone (near-midnight edge)', () => {
    expect(formatDate(new Date('2026-01-01T00:30:00.000Z'))).toBe('Jan 1, 2026');
  });

  it('never zero-pads the day (D, not DD)', () => {
    expect(formatDate(new Date('2025-09-05T00:00:00.000Z'))).toBe('Sep 5, 2025');
  });

  it('formats a December date correctly (year-end boundary)', () => {
    expect(formatDate(new Date('2025-12-31T23:59:00.000Z'))).toBe('Dec 31, 2025');
  });
});
