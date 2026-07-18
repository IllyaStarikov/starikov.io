/*
 * model.ts -- the one merge layer over the content collections.
 *
 * The wiki's shared schema is `SiteItem`: a uniform {type, slug, title,
 * tagline, href, date} that every surface (home feed, ⌘K index, Connections,
 * RSS, Pagefind) reads instead of touching collections directly. Only `tools`
 * exists today; `getAllItems()` is written so projects, essays and pages slot
 * in beside tools as their collections land, without changing consumers.
 *
 * `getToolPage()` is the auto+overlay merge seam for /bin pages. Auto tool data
 * is complete on its own (the design spec overlay rule); the future
 * `toolOverlays` collection will only DECORATE it. Until that collection
 * exists, the overlay is null and the merge is the identity -- but the seam is
 * here so the page never has to learn about overlays later.
 */

import { getCollection, getEntry, type CollectionEntry } from 'astro:content';

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

/**
 * Every site item, newest-first. Tools only for now; the shape is fixed so
 * projects/essays/pages append here later without touching any consumer.
 */
export async function getAllItems(): Promise<SiteItem[]> {
  const tools = await getCollection('tools');
  return tools
    .map(toolToItem)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
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
