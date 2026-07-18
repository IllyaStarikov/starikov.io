import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveRelatedEssaysCore, type EssayCandidate } from '../src/lib/related';
import { report } from '../src/loaders/lib/report';

// resolveRelatedEssaysCore's warnings go through report.warn(), which routes
// to console.log('::warning::...') under GITHUB_ACTIONS (see report.ts) and
// plain console.warn(...) otherwise. The tests below spy on console.warn, so
// they need the plain-console branch deterministically -- regardless of
// whether this file happens to run inside an actual CI job (GITHUB_ACTIONS is
// set ambiently there). Stub it unset for every test in this file so the
// suite's outcome never depends on the runner it executes on.
beforeEach(() => {
  vi.stubEnv('GITHUB_ACTIONS', undefined);
});

afterEach(() => {
  report.flush();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function essay(slug: string, publishedAt: string, tags: string[]): EssayCandidate {
  return {
    slug,
    title: `Title: ${slug}`,
    url: `https://starikov.co/${slug}/`,
    excerpt: `Excerpt for ${slug}.`,
    publishedAt: new Date(publishedAt),
    readingTime: 5,
    tags,
  };
}

// Deliberately NOT in date order, so a bug that trusts array order instead of
// sorting would be caught by the "most recent" assertions below.
const candidates: EssayCandidate[] = [
  essay('legacy-code-notes', '2015-01-01T00:00:00.000Z', ['code']),
  essay('commit-lifecycle', '2026-07-14T13:01:17.000Z', ['ai', 'software-engineering']),
  essay('older-post', '2020-01-01T00:00:00.000Z', ['code']),
  essay('theme-pipeline', '2026-06-01T00:00:00.000Z', ['code', 'software-engineering']),
  essay('atomic-updates', '2026-05-01T00:00:00.000Z', ['code']),
];

describe('resolveRelatedEssaysCore', () => {
  it('resolves manual `essays` slugs in the exact order listed, ignoring publish-date order', () => {
    const result = resolveRelatedEssaysCore(
      { essays: ['older-post', 'commit-lifecycle'], essayTags: [] },
      candidates,
    );
    expect(result.map((e) => e.title)).toEqual([
      'Title: older-post',
      'Title: commit-lifecycle',
    ]);
  });

  it('warns naming the overlay file and skips an unknown manual slug (no fuzzy matching)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = resolveRelatedEssaysCore(
      { essays: ['does-not-exist'], essayTags: [], filename: 'src/content/projects/dotfiles.mdx' },
      candidates,
    );
    expect(result).toEqual([]);
    expect(report.flush().warnings).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0] as [string];
    expect(message).toContain('does-not-exist');
    expect(message).toContain('src/content/projects/dotfiles.mdx');
  });

  it('falls back to a generic label when no filename is supplied', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveRelatedEssaysCore({ essays: ['nope'], essayTags: [] }, candidates);
    const [message] = warnSpy.mock.calls[0] as [string];
    expect(message).toContain('nope');
  });

  it('fills remaining slots up to 3 from essayTags matches, most-recent first, after manual picks', () => {
    const result = resolveRelatedEssaysCore(
      { essays: ['older-post'], essayTags: ['code'] },
      candidates,
    );
    // manual pick first, then the 2 MOST RECENT 'code'-tagged essays (excluding
    // the manual pick itself, which is also code-tagged -- proves de-dup) --
    // 'legacy-code-notes' (2015) is 'code'-tagged too but older than both
    // picked, proving the fill is sorted by recency, not array order.
    expect(result.map((e) => e.title)).toEqual([
      'Title: older-post',
      'Title: theme-pipeline',
      'Title: atomic-updates',
    ]);
  });

  it('resolves purely from essayTags (most recent 3) when no manual essays are given', () => {
    const result = resolveRelatedEssaysCore({ essays: [], essayTags: ['code'] }, candidates);
    expect(result.map((e) => e.title)).toEqual([
      'Title: theme-pipeline',
      'Title: atomic-updates',
      'Title: older-post',
    ]);
  });

  it('never returns more than 3 essays even with more tag matches available', () => {
    const result = resolveRelatedEssaysCore({ essays: [], essayTags: ['code'] }, candidates);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('resolves to [] when both essays and essayTags are empty (section absent, no fuzzy fallback)', () => {
    const result = resolveRelatedEssaysCore({ essays: [], essayTags: [] }, candidates);
    expect(result).toEqual([]);
    expect(report.flush().warnings).toBe(0);
  });

  it('does not fuzzy-match a tag slug against a similar-but-different slug', () => {
    const result = resolveRelatedEssaysCore(
      { essays: [], essayTags: ['softwar-engineering'] }, // typo'd slug, must not partial-match
      candidates,
    );
    expect(result).toEqual([]);
  });
});
