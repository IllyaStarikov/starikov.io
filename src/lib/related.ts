/*
 * related -- the "Related essays" resolver (design spec section 6: "manual-
 * first — overlay frontmatter `essays: [slugs]`, then `essayTags` matching,
 * else section absent. No fuzzy matching; unknown slugs warn with filename.").
 *
 * Same "testable pure core" split used throughout this codebase (see
 * `src/lib/projects.ts` next to `model.ts`, `src/loaders/github-meta.ts`'s
 * `mapRepoResponse`): `resolveRelatedEssaysCore` below takes plain data and has
 * NO `astro:content` import, so `test/related.test.ts` runs it under plain
 * vitest with hand-built candidate objects. `resolveRelatedEssays` is the
 * function project pages actually call (`model.ts`'s `getProjectPage`) --
 * its signature is exactly what Task 12 fixed, `(query) => Promise<Essay[]>`,
 * so no call site outside this task's own edit needs to change. It loads the
 * `essays` collection via a DYNAMIC `import('astro:content')` inside the
 * function body rather than a static top-level import specifically so this
 * file stays importable (and its pure core testable) from plain vitest, which
 * cannot resolve the `astro:content` virtual module -- a static import would
 * fail at module-load time for every test that touches this file, even ones
 * that only want `resolveRelatedEssaysCore` or the `Essay` type.
 */

import { report } from '../loaders/lib/report';

/**
 * One resolved essay, as the project pages consume it. The Ghost loader
 * (`src/loaders/ghost.ts`) populates the `essays` collection this maps from;
 * the fields are the minimum a "Related essays" row needs (title + link + a
 * one-line excerpt) plus the metadata a future richer row can show (date,
 * reading time, tags) without another schema change.
 */
export interface Essay {
  title: string;
  /** Canonical URL on starikov.co -- essay rows link OUT (design spec section 13). */
  url: string;
  excerpt: string;
  publishedAt: Date;
  /** Whole minutes, as Ghost reports it. */
  readingTime: number;
  tags: string[];
}

/** The slice of a project overlay's frontmatter this resolver reads. */
export interface RelatedEssayQuery {
  essays?: string[];
  essayTags?: string[];
  /** The overlay's own source file (e.g. `src/content/projects/dotfiles.mdx`),
   *  named in an unknown-manual-slug warning so it's obvious which file to
   *  fix. Optional -- callers/tests that don't care about the warning text
   *  can omit it; the warning falls back to a generic label. */
  filename?: string;
}

/** An `Essay` plus the slug it's matched against -- what the pure core needs
 *  to resolve manual `essays: [slug]` references. The Astro-facing wrapper
 *  below builds these from the `essays` collection's entry ids. */
export interface EssayCandidate extends Essay {
  slug: string;
}

/** Design spec: "essayTags -> most recent 3 matching". Applies to a pure
 *  tag-only resolution AND as the ceiling when manual picks are filled out
 *  with tag matches. */
const MAX_RESOLVED = 3;
const SOURCE = 'related-essays';

/**
 * PURE resolution core. Manual `essays:` slugs resolve first, in the EXACT
 * order listed (not date order) -- an unknown slug warns (naming
 * `query.filename`) and is skipped, never silently dropped and never
 * fuzzy-matched to a near-miss. If that leaves fewer than `MAX_RESOLVED`
 * essays and `essayTags` is non-empty, the remaining slots are filled from
 * essays whose `tags` intersect `essayTags` (exact slug match only), most
 * recently published first, excluding anything already picked manually. No
 * manual picks and no tags -> `[]` (the RelatedEssays section stays absent).
 */
export function resolveRelatedEssaysCore(
  query: RelatedEssayQuery,
  candidates: EssayCandidate[],
): Essay[] {
  const bySlug = new Map(candidates.map((c) => [c.slug, c]));
  const resolved: EssayCandidate[] = [];
  const seen = new Set<string>();

  for (const slug of query.essays ?? []) {
    const essay = bySlug.get(slug);
    if (!essay) {
      report.warn(
        SOURCE,
        `unknown essay slug "${slug}" referenced in ${query.filename ?? 'an overlay file'}`,
      );
      continue;
    }
    if (seen.has(essay.slug)) continue; // a slug listed twice in frontmatter
    resolved.push(essay);
    seen.add(essay.slug);
  }

  const tags = query.essayTags ?? [];
  if (resolved.length < MAX_RESOLVED && tags.length > 0) {
    const tagMatches = candidates
      .filter((c) => !seen.has(c.slug) && c.tags.some((t) => tags.includes(t)))
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
    for (const essay of tagMatches) {
      if (resolved.length >= MAX_RESOLVED) break;
      resolved.push(essay);
      seen.add(essay.slug);
    }
  }

  return resolved.map(({ slug: _slug, ...essay }) => essay);
}

/**
 * Astro-facing wrapper: loads the `essays` collection and runs the pure core
 * above. See the module doc for why the `astro:content` import is dynamic.
 */
export async function resolveRelatedEssays(query: RelatedEssayQuery): Promise<Essay[]> {
  const { getCollection } = await import('astro:content');
  const entries = await getCollection('essays');
  const candidates: EssayCandidate[] = entries.map((entry) => ({
    slug: entry.id,
    title: entry.data.title,
    url: entry.data.url,
    excerpt: entry.data.excerpt,
    publishedAt: entry.data.publishedAt,
    readingTime: entry.data.readingTime,
    tags: entry.data.tags,
  }));
  return resolveRelatedEssaysCore(query, candidates);
}
