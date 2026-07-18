/*
 * model.ts -- the one merge layer over the content collections.
 *
 * The wiki's shared schema is `SiteItem`: a uniform {type, slug, title,
 * tagline, href, date} that every surface (home feed, ⌘K index, Connections,
 * RSS, Pagefind) reads instead of touching collections directly. Tools,
 * projects and static pages flow through it today; essays slot in beside them
 * as Task 14's collection lands, without changing consumers.
 *
 * `getToolPage()` is the auto+overlay merge seam for /bin pages. Auto tool data
 * is complete on its own (the design spec overlay rule); the future
 * `toolOverlays` collection will only DECORATE it. Until that collection
 * exists, the overlay is null and the merge is the identity -- but the seam is
 * here so the page never has to learn about overlays later.
 *
 * `getProjectPage()` is the INVERSE arrangement (design spec section 6: the
 * curated MDX IS the page, and auto `repos` metadata joins ON): a project's
 * frontmatter names one repo (`repo`) or a cluster (`repos`), and this module
 * joins those against the `repos` collection (keyed by LOWERCASED "owner/name")
 * to decorate the page with live stars / last-push / language. The join,
 * summary and ordering logic are pulled out as pure functions (`joinRepos`,
 * `summarizeRepos`, `sortProjects`, `projectToItem`) so they unit-test with
 * plain objects, no Astro runtime -- the established "testable pure core"
 * pattern.
 */

import { getCollection, getEntry, render, type CollectionEntry } from 'astro:content';
import type { MarkdownHeading } from 'astro';
import { resolveRelatedEssays, type Essay } from './related';
import {
  joinRepos,
  summarizeRepos,
  sortProjects,
  projectToItem,
  type ProjectRepoData,
  type RepoSummary,
} from './projects';

// Re-exported so the pure project cores have one public home (model.ts) even
// though they live in the Astro-free `./projects` module for testability.
export {
  joinRepos,
  summarizeRepos,
  sortProjects,
  projectToItem,
  type ProjectRepoData,
  type RepoSummary,
};

export type SiteItemType = 'tool' | 'project' | 'essay' | 'page';

export interface SiteItem {
  type: SiteItemType;
  slug: string;
  title: string;
  tagline: string;
  href: string;
  /** ISO date; drives newest-first ordering where present. */
  date?: string;
}

type ToolEntry = CollectionEntry<'tools'>;

/** Curated decoration for a tool page. The `toolOverlays` collection lands in a
 *  later task; until then every tool's overlay is null. */
export type ToolOverlay = null;

export interface ToolPage {
  slug: string;
  data: ToolEntry['data'];
  overlay: ToolOverlay;
}

function toolToItem(entry: ToolEntry): SiteItem {
  return {
    type: 'tool',
    slug: entry.id,
    title: entry.data.name,
    tagline: entry.data.tagline,
    href: `/bin/${entry.id}`,
    date: entry.data.updated,
  };
}

// ---------------------------------------------------------------------------
// Projects: curated MDX + joined `repos` metadata
//
// The pure merge cores (joinRepos / summarizeRepos / sortProjects /
// projectToItem) live in ./projects and are re-exported above. This section is
// only the Astro-facing glue: repo-name extraction and the two loaders.
// ---------------------------------------------------------------------------

type ProjectEntry = CollectionEntry<'projects'>;

/** The repo names a project joins on: its single `repo`, then its `repos[]`. */
function repoNames(data: ProjectEntry['data']): string[] {
  return [...(data.repo ? [data.repo] : []), ...data.repos];
}

/**
 * Static pages that are first-class site items (⌘K / search / Connections /
 * home feed) but aren't collection-backed. /academia is one uniform record: a
 * marquee page over the archived coursework, not a per-entry route in v1.
 */
const PAGE_ITEMS: SiteItem[] = [
  {
    type: 'page',
    slug: 'academia',
    title: 'Academia',
    tagline: 'Four bound LaTeX volumes and a media showcase from the Missouri S&T years.',
    href: '/academia',
  },
];

/**
 * Every site item, newest-first. Tools + projects + static pages today; essays
 * append here when Task 14's collection lands, without touching any consumer.
 * Undated items (pages) sort after dated ones.
 */
export async function getAllItems(): Promise<SiteItem[]> {
  const tools = await getCollection('tools');
  const projects = (await getCollection('projects')).filter((p) => !p.data.draft);
  const repos = await getCollection('repos');
  const projectItems = projects.map((entry) =>
    projectToItem(entry, summarizeRepos(joinRepos(repoNames(entry.data), repos)).updated),
  );
  return [...tools.map(toolToItem), ...projectItems, ...PAGE_ITEMS].sort((a, b) =>
    (b.date ?? '').localeCompare(a.date ?? ''),
  );
}

/**
 * Merge a tool's auto data with its (future) curated overlay. Returns null when
 * no tool has that slug. Overlays only add; they never replace auto content.
 */
export async function getToolPage(slug: string): Promise<ToolPage | null> {
  const entry = await getEntry('tools', slug);
  if (!entry) return null;
  const overlay: ToolOverlay = null; // toolOverlays collection arrives later
  return mergeToolOverlay(entry, overlay);
}

function mergeToolOverlay(entry: ToolEntry, overlay: ToolOverlay): ToolPage {
  // Single merge point: when toolOverlays exists, fold its decoration into a
  // copy of `data` here (additive only). For now the auto entry is the page.
  return { slug: entry.id, data: entry.data, overlay };
}

/** Everything a /projects/<slug> page needs: the rendered MDX body, the parsed
 *  headings (for the TOC), the joined repo metadata + its summary, and the
 *  resolved related essays (empty until Task 14). */
export interface ProjectPage {
  slug: string;
  data: ProjectEntry['data'];
  Content: Awaited<ReturnType<typeof render>>['Content'];
  headings: MarkdownHeading[];
  /** Joined repo metadata, in frontmatter order (may be empty offline). */
  repos: ProjectRepoData[];
  /** Derived facts for the strip/rail. */
  summary: RepoSummary;
  /** Related essays; `[]` (section hidden) until Task 14 implements resolution. */
  essays: Essay[];
}

/**
 * Load a project page: render its MDX and join `repos` metadata onto it.
 * Returns null when no project has that slug or the entry is a draft (so
 * getStaticPaths and any direct caller agree on what exists). The repo join is
 * decoration -- a build with no live/cached/vendor metadata still returns a
 * complete page, just without stars/last-push.
 */
export async function getProjectPage(slug: string): Promise<ProjectPage | null> {
  const entry = await getEntry('projects', slug);
  if (!entry || entry.data.draft) return null;

  const { Content, headings } = await render(entry);
  const repos = joinRepos(repoNames(entry.data), await getCollection('repos'));
  const essays = await resolveRelatedEssays({
    essays: entry.data.essays,
    essayTags: entry.data.essayTags,
  });

  return {
    slug: entry.id,
    data: entry.data,
    Content,
    headings,
    repos,
    summary: summarizeRepos(repos),
    essays,
  };
}
