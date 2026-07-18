/*
 * fuzzy.ts -- the ⌘K palette's ranking core (pure, no DOM, unit-tested).
 *
 * `fuzzyScore(query, text)` is a greedy left-to-right subsequence matcher: every
 * character of `query` must appear in `text` in order, or the score is 0. Each
 * matched character earns a base point plus, where earned, three additive
 * bonuses that pull the match toward the most "word-like" hit:
 *   - START     the match sits at index 0 of the string
 *   - BOUNDARY  the match follows a separator (space - _ / . :) or a
 *               lower->upper camelCase seam
 *   - CONTIG    the match immediately follows the previous matched character
 * START outweighs BOUNDARY so a prefix hit ("Theme: …" for `theme`) ranks above
 * a mid-string word hit ("colophon theme …"). The matcher is greedy, not
 * optimal -- it takes the first subsequence it finds -- which is both smaller
 * and plenty for a title/slug corpus.
 *
 * `rankItem(query, title, tagline)` is the wrapper the palette uses: a title hit
 * scores at full weight, a tagline hit at half, and the better of the two wins,
 * so a title match always outranks a tagline-only match for the same query.
 */

const BASE = 1;
const START_BONUS = 10;
const BOUNDARY_BONUS = 8;
const CONTIG_BONUS = 4;

/** Weight applied to a tagline match relative to a title match. */
export const TAGLINE_WEIGHT = 0.5;

const SEPARATORS = new Set([' ', '-', '_', '/', '.', ':', '\t']);

function isBoundary(prev: string, cur: string): boolean {
  if (SEPARATORS.has(prev)) return true;
  // camelCase seam: a lowercase/digit immediately before an uppercase letter.
  return prev >= 'a' && prev <= 'z' && cur >= 'A' && cur <= 'Z';
}

/**
 * Score how well `query` matches `text`. 0 means "not a subsequence" (or an
 * empty query); higher is a better, more word-aligned match. Case-insensitive.
 */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  // Boundary detection reads the ORIGINAL text so the camelCase seam survives
  // the lowercasing above.
  const raw = text;

  let qi = 0;
  let score = 0;
  let prevMatch = -2; // index of the previous matched char (for contiguity)

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;

    let charScore = BASE;
    if (ti === 0) charScore += START_BONUS;
    else if (isBoundary(raw[ti - 1], raw[ti])) charScore += BOUNDARY_BONUS;
    if (ti === prevMatch + 1) charScore += CONTIG_BONUS;

    score += charScore;
    prevMatch = ti;
    qi++;
  }

  // Not every query character was consumed -> not a subsequence.
  return qi === q.length ? score : 0;
}

/**
 * Rank an item by its title (full weight) and tagline (half weight); the higher
 * of the two wins. Returns 0 when neither field matches.
 */
export function rankItem(query: string, title: string, tagline = ''): number {
  const titleScore = fuzzyScore(query, title);
  const taglineScore = tagline ? fuzzyScore(query, tagline) * TAGLINE_WEIGHT : 0;
  return Math.max(titleScore, taglineScore);
}
