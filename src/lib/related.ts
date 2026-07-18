/*
 * related -- the "Related essays" resolver seam.
 *
 * A project overlay may declare related writing manually (`essays: [slug]`) or
 * by tag (`essayTags: [tag]`). Resolving those into real essays needs the Ghost
 * essays collection, which lands in Task 14. Until then this is a STUB that
 * always resolves to `[]`, so the RelatedEssays section renders nothing (it is
 * hidden while empty) and the project pages ship complete today.
 *
 * The contract is fixed here so Task 14 only fills in the body, never the
 * signature or the shape consumers read:
 *
 *   - the `Essay` type below is what Task 14's implementation MUST return, and
 *     what RelatedEssays.astro already renders against;
 *   - resolution is manual-first (design spec section 6): explicit `essays`
 *     slugs in listed order, then `essayTags` matches to fill out, de-duplicated,
 *     unknown slugs warned-with-filename (Task 14) rather than silently dropped.
 *     No fuzzy matching.
 */

/**
 * One resolved essay, as the project pages consume it. Task 14 maps a Ghost
 * post onto this shape; the fields are the minimum a "Related essays" row needs
 * (title + link + a one-line excerpt) plus the metadata a future richer row can
 * show (date, reading time, tags) without another schema change.
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
}

/**
 * Resolve a project's related essays. STUB: returns `[]` until Task 14 wires in
 * the essays collection. The signature and return type are final -- Task 14
 * implements the body against the manual-first rules documented above.
 */
export async function resolveRelatedEssays(_query: RelatedEssayQuery): Promise<Essay[]> {
  return [];
}
