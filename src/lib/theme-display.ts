/*
 * theme-display -- turn a full theme id into the neofetch-style "family/variant"
 * label the home system card prints (e.g. "tokyonight-storm" -> "tokyonight/storm").
 *
 * The card renders the DEFAULT theme's label at SSR time, then a tiny client
 * enhancement re-reads document.documentElement.dataset.theme after boot and on
 * every 'themechange' to keep the printed line honest. Both sides use the map
 * built here, so the display is computed one way.
 *
 * The build map (`THEME_DISPLAY_MAP`) is derived from the generated manifest and
 * embedded on the card as a data attribute; the pure `buildThemeDisplayMap` /
 * `themeDisplayName` take injected data so they unit-test with plain objects,
 * no Astro runtime -- the established "testable pure core" pattern.
 */
import themesData from '../data/generated/themes.json';

/** The shape `buildThemeDisplayMap` needs from a family: its id + each variant's
 *  full id and short variantId. A structural subset of the manifest's families. */
export interface DisplayFamily {
  id: string;
  variants: { id: string; variantId: string }[];
}

/**
 * Map every variant's full id to its "family/variant" display label. Built once
 * over the whole manifest so the card can resolve any theme the boot script can
 * land on without a per-id split (variant ids may themselves contain separators,
 * so a naive `id.split('-')` is fragile -- this table is exact).
 */
export function buildThemeDisplayMap(families: DisplayFamily[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const family of families) {
    for (const variant of family.variants) {
      map[variant.id] = `${family.id}/${variant.variantId}`;
    }
  }
  return map;
}

/** The display map for the running build (all curated families' variants). */
export const THEME_DISPLAY_MAP: Record<string, string> = buildThemeDisplayMap(themesData.families);

/**
 * Display label for one full theme id. Prefers the exact map; falls back to a
 * first-hyphen split for any id not in it (defensive -- the boot only lands on
 * mapped ids, but an unknown id should read "family/variant", never crash).
 */
export function themeDisplayName(
  id: string,
  map: Record<string, string> = THEME_DISPLAY_MAP,
): string {
  if (map[id]) return map[id];
  const dash = id.indexOf('-');
  return dash === -1 ? id : `${id.slice(0, dash)}/${id.slice(dash + 1)}`;
}
