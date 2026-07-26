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
import { selectRecentItems } from './recent';
import { PAGE_ITEMS } from './page-items';

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

// Same re-export arrangement for the home page's RECENTLY UPDATED selection
// (see `./recent` -- Astro-free for the same testability reason).
export { selectRecentItems };

// Same arrangement again for the static-page SiteItems (see `./page-items` --
// Astro-free for the same testability reason; test/page-items.test.ts pins
// its shape and every downstream ripple directly).
export { PAGE_ITEMS };

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

type EssayEntry = CollectionEntry<'essays'>;

/** An essay's `href` points OUT to starikov.co (design spec §13: essays are
 *  read there, not mirrored locally) -- the one SiteItem type whose href
 *  isn't a site-local route, which is why `getAllItems`' consumers (the home
 *  "recently updated" ledger) mark `external: item.type === 'essay'`. */
function essayToItem(entry: EssayEntry): SiteItem {
  return {
    type: 'essay',
    slug: entry.id,
    title: entry.data.title,
    tagline: entry.data.excerpt,
    href: entry.data.url,
    date: entry.data.publishedAt.toISOString(),
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
 * Every site item, newest-first: tools + projects + essays + static pages.
 * Undated items (pages) sort after dated ones.
 */
export async function getAllItems(): Promise<SiteItem[]> {
  const tools = await getCollection('tools');
  const projects = (await getCollection('projects')).filter((p) => !p.data.draft);
  const repos = await getCollection('repos');
  const essays = await getCollection('essays');
  const projectItems = projects.map((entry) =>
    projectToItem(entry, summarizeRepos(joinRepos(repoNames(entry.data), repos)).updated),
  );
  return [...tools.map(toolToItem), ...projectItems, ...essays.map(essayToItem), ...PAGE_ITEMS].sort(
    (a, b) => (b.date ?? '').localeCompare(a.date ?? ''),
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
 *  resolved related essays (`[]` when the overlay names none). */
export interface ProjectPage {
  slug: string;
  data: ProjectEntry['data'];
  Content: Awaited<ReturnType<typeof render>>['Content'];
  headings: MarkdownHeading[];
  /** Joined repo metadata, in frontmatter order (may be empty offline). */
  repos: ProjectRepoData[];
  /** Derived facts for the strip/rail. */
  summary: RepoSummary;
  /** Related essays (resolved by src/lib/related.ts); `[]` hides the section. */
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
    // Matches the string projects/[...slug].astro already builds for the
    // ProvenanceFooter's overlay link -- one convention for "this overlay's
    // source file", not `entry.filePath` (which the glob loader also sets,
    // but this keeps the two call sites' text identical without a second
    // source of truth for the same fact).
    filename: `src/content/projects/${entry.id}.mdx`,
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
