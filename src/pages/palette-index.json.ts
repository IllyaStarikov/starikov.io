/*
 * /palette-index.json -- the ⌘K palette's build-generated index (design §8).
 *
 * Prerendered to a static file (static output: every route is prerendered, but
 * we say so explicitly). The palette fetches it on first open (~15KB): every
 * SiteItem plus the curated theme rows. The data assembly lives in the pure
 * builders in src/lib/palette-index.ts so the payload's shape is unit-tested
 * without the Astro runtime; this file is only the async collection glue.
 */
import type { APIRoute } from 'astro';
import themesData from '../data/generated/themes.json';
import { getAllItems } from '../lib/model';
import { buildPaletteIndex } from '../lib/palette-index';

export const prerender = true;

export const GET: APIRoute = async () => {
  const items = await getAllItems();
  // Date-granular version: stable within a build day, rolls with the nightly
  // essay-freshness rebuild -- enough to bust a stale client cache.
  const version = new Date().toISOString().slice(0, 10);
  const index = buildPaletteIndex(items, themesData.families, version);
  return new Response(JSON.stringify(index), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};
