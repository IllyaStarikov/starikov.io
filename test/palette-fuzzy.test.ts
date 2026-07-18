import { describe, expect, it } from 'vitest';
import { fuzzyScore, rankItem } from '../src/lib/fuzzy';

/*
 * The ⌘K palette's ranking core. `fuzzyScore(query, text)` is a subsequence
 * matcher with three additive bonuses -- match at string start, match at a word
 * boundary, and a run of contiguous matches -- so a query lands on the most
 * "word-like" hit. `rankItem` layers the title/tagline weighting the palette
 * uses (a title hit always outweighs a tagline-only hit).
 *
 * These are the brief's literal cases, asserted as pure-function properties so
 * the palette's relevance is testable with no DOM.
 */

describe('fuzzyScore: matching', () => {
  it('returns 0 for a non-subsequence', () => {
    expect(fuzzyScore('xyz', 'pocketcasts-reset')).toBe(0);
    // "pcr" is not a subsequence of "projects" (no r after the c)
    expect(fuzzyScore('pcr', 'projects')).toBe(0);
  });

  it('returns 0 for an empty query (neutral)', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
    expect(fuzzyScore('', '')).toBe(0);
  });

  it('scores a subsequence match above zero', () => {
    expect(fuzzyScore('pcr', 'pocketcasts-reset')).toBeGreaterThan(0);
  });

  it("ranks 'pcr' on pocketcasts-reset above the non-matching 'projects'", () => {
    expect(fuzzyScore('pcr', 'pocketcasts-reset')).toBeGreaterThan(
      fuzzyScore('pcr', 'projects'),
    );
  });

  it('is case-insensitive', () => {
    expect(fuzzyScore('PCR', 'pocketcasts-reset')).toBe(fuzzyScore('pcr', 'POCKETCASTS-RESET'));
    expect(fuzzyScore('Theme', 'theme: catppuccin')).toBe(fuzzyScore('theme', 'Theme: Catppuccin'));
  });
});

describe('fuzzyScore: bonuses', () => {
  it('rewards a match at the start of the string over a match in the middle', () => {
    expect(fuzzyScore('po', 'pocketcasts')).toBeGreaterThan(fuzzyScore('po', 'apollo'));
  });

  it('rewards a match at a word boundary over a match mid-word', () => {
    expect(fuzzyScore('r', 'x-ray')).toBeGreaterThan(fuzzyScore('r', 'xray'));
  });

  it('rewards contiguous matches over gapped ones', () => {
    expect(fuzzyScore('ab', 'xab')).toBeGreaterThan(fuzzyScore('ab', 'xaxb'));
  });
});

describe("fuzzyScore: 'theme' ranks Theme commands and colophon sensibly", () => {
  it('scores the Theme command (prefix) above the colophon substring, both > 0', () => {
    const themeCmd = fuzzyScore('theme', 'Theme: Catppuccin');
    const colophon = fuzzyScore('theme', 'colophon theme pipeline');
    expect(themeCmd).toBeGreaterThan(colophon);
    expect(colophon).toBeGreaterThan(0);
  });
});

describe('rankItem: title beats tagline', () => {
  it('scores a title match higher than the same query matching only the tagline', () => {
    const titleHit = rankItem('foo', 'foo widget', 'unrelated words');
    const taglineHit = rankItem('foo', 'unrelated words', 'foo widget');
    expect(titleHit).toBeGreaterThan(taglineHit);
    expect(taglineHit).toBeGreaterThan(0);
  });

  it('falls back to the tagline when the title does not match', () => {
    expect(rankItem('reset', 'pocketcasts', 'reset your subscriptions')).toBeGreaterThan(0);
  });

  it('returns 0 when neither title nor tagline matches', () => {
    expect(rankItem('zzz', 'pocketcasts', 'reset your subscriptions')).toBe(0);
  });
});
