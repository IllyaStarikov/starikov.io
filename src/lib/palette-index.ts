/*
 * palette-index.ts -- pure builders for the ⌘K index endpoint
 * (src/pages/palette-index.json.ts). Kept Astro-free so the endpoint's shape is
 * unit-tested with plain fixtures (the established "testable pure core" pattern).
 *
 * The endpoint serves `{ items, themes, version }`:
 *   items   every SiteItem from model.ts's getAllItems() (tools, projects,
 *           essays, static pages) -- the wiki's shared schema, verbatim.
 *   themes  one row per CURATED family, reduced to the minimum the palette's
 *           Theme group needs: the family id, its display name, and the accent
 *           hex for each mode (so a row can paint a swatch that recolors with the
 *           active light/dark mode). Only curated families reach the palette --
 *           themes.json already contains only curated (paired) families.
 *   version a cheap cache/staleness marker.
 */
import type { SiteItem } from './model';

/** Longest tagline the index carries. The palette shows the tagline as one
 *  ellipsis-truncated line, so a longer excerpt is never visible -- trimming it
 *  keeps the payload near the ~15KB the design budgets for (some essay excerpts
 *  run to 500 chars). */
export const MAX_TAGLINE = 72;

function trimTagline(s: string): string {
  return s.length > MAX_TAGLINE ? s.slice(0, MAX_TAGLINE - 1).trimEnd() + '…' : s;
}

/** Project a SiteItem down to what the palette actually reads: the `date` field
 *  is dropped (the index arrives pre-sorted newest-first, and the palette never
 *  reads dates), and the tagline is trimmed to a single-line preview. */
function toIndexItem(it: SiteItem): SiteItem {
  return {
    type: it.type,
    slug: it.slug,
    title: it.title,
    tagline: trimTagline(it.tagline),
    href: it.href,
  };
}

export interface ThemeEntry {
  family: string;
  name: string;
  /** Accent hex of the family's dark variant. */
  dark: string;
  /** Accent hex of the family's light variant. */
  light: string;
}

export interface PaletteIndex {
  items: SiteItem[];
  themes: ThemeEntry[];
  version: string;
}

/** The subset of a themes.json family this module reads. */
export interface IndexFamily {
  id: string;
  name: string;
  pair: { light: string; dark: string };
  variants: { id: string; swatch: { accent: string } }[];
}

function accentOf(family: IndexFamily, variantId: string): string {
  return family.variants.find((v) => v.id === variantId)?.swatch.accent ?? '';
}

/** Reduce curated families to the palette's Theme rows, in manifest order. */
export function buildThemeEntries(families: IndexFamily[]): ThemeEntry[] {
  return families.map((f) => ({
    family: f.id,
    name: f.name,
    dark: accentOf(f, f.pair.dark),
    light: accentOf(f, f.pair.light),
  }));
}

/** Assemble the full `{ items, themes, version }` index payload. Items are
 *  projected to the palette's minimal shape (trimmed tagline, no date). */
export function buildPaletteIndex(
  items: SiteItem[],
  families: IndexFamily[],
  version: string,
): PaletteIndex {
  return { items: items.map(toIndexItem), themes: buildThemeEntries(families), version };
}
