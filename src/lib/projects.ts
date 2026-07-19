/*
 * projects -- the Astro-free pure core behind the project pages.
 *
 * These four functions are the whole of the project auto+overlay merge logic
 * (join repo metadata onto a curated overlay, summarise it, order the ledger,
 * shape a SiteItem). They take their data as plain arguments -- no
 * `astro:content`, no IO -- so they unit-test with objects, mirroring how the
 * loaders keep their pure cores importable without the Astro runtime.
 *
 * `src/lib/model.ts` imports and re-exports these, adds the `astro:content`
 * calls (getCollection / getEntry / render) around them, and owns the SiteItem
 * type they reference (a type-only import here, erased at runtime, so this
 * module never pulls in the Astro-facing layer).
 */

import type { SiteItem } from './model';

const GITHUB_ORIGIN = 'https://github.com';

/** One `repos` collection entry's `data` -- the joined-on GitHub metadata. */
export interface ProjectRepoData {
  fullName: string;
  description: string | null;
  stars: number;
  pushedAt: Date;
  language: string | null;
  topics: string[];
  archived: boolean;
  /** True when this run's data came from a fallback tier, not a live fetch. */
  stale: boolean;
}

/** A repos-collection entry (id = lowercased "owner/name"). */
export interface RepoEntry {
  id: string;
  data: ProjectRepoData;
}

/** The derived facts a project's MetadataStrip / rail shows. */
export interface RepoSummary {
  /** First non-null language across the joined repos. */
  language: string | null;
  /** Summed stars, or null to OMIT the badge (any repo stale, or zero total). */
  stars: number | null;
  /** Most recent push across the joined repos, or null when any joined repo
   *  is stale -- a relative "updated N days ago" computed from cached data is
   *  a freshness claim the build can't back up (same reasoning as `stars`). */
  updated: Date | null;
  /** True when any joined repo's metadata is stale this build. */
  stale: boolean;
  /** One "repo ↗" link per joined repo, in frontmatter order. */
  repos: { fullName: string; url: string }[];
}

/**
 * Join a project's `repo`/`repos` frontmatter names to their `repos`
 * collection entries, by LOWERCASED id (the collection keys every entry by its
 * lowercased "owner/name", so the join is case-insensitive -- this is what lets
 * `illyaStarikov/resume` in site.config match `IllyaStarikov/...` casing
 * elsewhere). Order follows the requested names. A name with no entry (repo
 * metadata unavailable this build) is dropped -- repo data is decoration, never
 * a gate on the page rendering. PURE.
 */
export function joinRepos(names: string[], repos: RepoEntry[]): ProjectRepoData[] {
  const byId = new Map(repos.map((r) => [r.id, r.data]));
  return names
    .map((name) => byId.get(name.toLowerCase()))
    .filter((data): data is ProjectRepoData => data !== undefined);
}

/**
 * Reduce joined repo metadata to the handful of facts a project page shows.
 * PURE. Stars are omitted (null) when any repo is stale -- a stale star count
 * is worse than none (design spec: "omit stars when stale") -- and when the
 * total is zero, so a new repo doesn't show a lonely "★ 0". `updated` is
 * likewise nulled when any repo is stale: a relative "updated N days ago"
 * derived from cached data implies a freshness the build didn't verify this
 * run, the same false-currency problem as the star count.
 */
export function summarizeRepos(metas: ProjectRepoData[]): RepoSummary {
  const stale = metas.some((m) => m.stale);
  const starTotal = metas.reduce((sum, m) => sum + m.stars, 0);
  const updated = metas.reduce<Date | null>(
    (latest, m) => (latest === null || m.pushedAt > latest ? m.pushedAt : latest),
    null,
  );
  return {
    language: metas.find((m) => m.language)?.language ?? null,
    stars: stale || starTotal === 0 ? null : starTotal,
    updated: stale ? null : updated,
    stale,
    repos: metas.map((m) => ({ fullName: m.fullName, url: `${GITHUB_ORIGIN}/${m.fullName}` })),
  };
}

/** The frontmatter fields ordering needs, structurally typed so the pure sorter
 *  tests with plain objects. */
interface ProjectOrderable {
  data: { title: string; featured: boolean; order: number };
}

/**
 * Ledger + sidebar order: featured projects first, then the rest; each group by
 * ascending `order`, ties broken by title so the sort is stable and
 * deterministic across builds. PURE.
 */
export function sortProjects<T extends ProjectOrderable>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.data.featured !== b.data.featured) return a.data.featured ? -1 : 1;
    if (a.data.order !== b.data.order) return a.data.order - b.data.order;
    return a.data.title.localeCompare(b.data.title);
  });
}

/**
 * Map a project entry to the uniform SiteItem. Dated from the joined repo's
 * most-recent push (so it sorts into "Recently Updated" alongside tools);
 * undated when no repo metadata is available. PURE.
 */
export function projectToItem(
  entry: { id: string; data: { title: string; tagline: string } },
  updated: Date | null,
): SiteItem {
  return {
    type: 'project',
    slug: entry.id,
    title: entry.data.title,
    tagline: entry.data.tagline,
    href: `/projects/${entry.id}`,
    date: updated ? updated.toISOString() : undefined,
  };
}
