// Shared manifest/colors.json schema + loader for the dotfiles theme engine.
// Used by both scripts/build-themes.mjs (CSS/JSON generation) and
// scripts/refresh-snapshots.mjs (committed vendor snapshot refresh), so the
// two can never validate against different rules.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const hex = () => z.string().regex(HEX_RE, 'expected a 6-digit hex color');

// 26 keys total: 10 structural (incl. `name`) + 16 ANSI (8 base + 8 bright).
// Verified against the real .sources/dotfiles/src/theme/**/colors.json files.
export const ColorsSchema = z.object({
  name: z.string(),
  bg: hex(),
  fg: hex(),
  cursor: hex(),
  selection_bg: hex(),
  accent: hex(),
  accent_alt: hex(),
  border: hex(),
  muted: hex(),
  surface: hex(),
  black: hex(),
  red: hex(),
  green: hex(),
  yellow: hex(),
  blue: hex(),
  magenta: hex(),
  cyan: hex(),
  white: hex(),
  bright_black: hex(),
  bright_red: hex(),
  bright_green: hex(),
  bright_yellow: hex(),
  bright_blue: hex(),
  bright_magenta: hex(),
  bright_cyan: hex(),
  bright_white: hex(),
});

// `looseObject` (not `.object().passthrough()`, deprecated in zod v4) because
// the real manifest carries plenty of fields we don't consume (url,
// neovim_plugin, neovim_colorscheme, bat_theme, ...) and we don't want this
// schema to break every time dotfiles adds one.
const ManifestVariantSchema = z.looseObject({
  display_name: z.string(),
  mode: z.enum(['light', 'dark']),
});

const ManifestFamilySchema = z.looseObject({
  name: z.string(),
  variants: z.record(z.string(), ManifestVariantSchema),
});

export const ManifestSchema = z.looseObject({
  defaults: z.object({ light: z.string(), dark: z.string() }),
  families: z.record(z.string(), ManifestFamilySchema),
});

/**
 * Attempt to load + validate manifest + curated colors.json files from `dir`,
 * restricted to `curatedFamilies` and cross-checked against `webPairs`.
 * Never throws for expected data problems -- returns a result object so the
 * caller can decide whether to retry from a different source.
 *
 * @param {string} dir
 * @param {{ curatedFamilies: string[], webPairs: Record<string, {light:string,dark:string}> }} opts
 */
export function loadThemeSource(dir, { curatedFamilies, webPairs, onWarn = () => {} }) {
  const manifestPath = join(dir, 'config/themes.json');
  if (!existsSync(manifestPath)) {
    return { ok: false, reason: `manifest not found at ${manifestPath}` };
  }

  let rawManifest;
  try {
    rawManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    return { ok: false, reason: `manifest is not valid JSON: ${e.message}` };
  }

  const manifestResult = ManifestSchema.safeParse(rawManifest);
  if (!manifestResult.success) {
    return { ok: false, reason: `manifest failed schema validation: ${manifestResult.error.message}` };
  }
  const manifest = manifestResult.data;

  /** @type {Array<{familyId:string, familyName:string, variantId:string, displayName:string, mode:'light'|'dark', colors: object}>} */
  const survivors = [];

  for (const familyId of curatedFamilies) {
    const family = manifest.families[familyId];
    if (!family) {
      // Family entirely absent from this source (e.g. a minimal test fixture).
      // Not an error on its own -- it simply contributes zero variants.
      continue;
    }

    for (const [variantId, variantMeta] of Object.entries(family.variants)) {
      const colorsPath = join(dir, 'src/theme', familyId, variantId, 'colors.json');
      if (!existsSync(colorsPath)) {
        onWarn(`${familyId}/${variantId}: colors.json missing at ${colorsPath} -- skipping`);
        continue;
      }

      let rawColors;
      try {
        rawColors = JSON.parse(readFileSync(colorsPath, 'utf8'));
      } catch (e) {
        onWarn(`${familyId}/${variantId}: colors.json is not valid JSON (${e.message}) -- skipping`);
        continue;
      }

      const colorsResult = ColorsSchema.safeParse(rawColors);
      if (!colorsResult.success) {
        onWarn(`${familyId}/${variantId}: colors.json failed schema validation -- skipping`);
        continue;
      }

      survivors.push({
        familyId,
        familyName: family.name,
        variantId,
        displayName: variantMeta.display_name,
        mode: variantMeta.mode,
        colors: colorsResult.data,
      });
    }

    // If webPairs names a variant for this family, the manifest must actually
    // define it -- a mismatch means site.config.mjs drifted from reality,
    // which is always a hard error (not a soft skip).
    const pair = webPairs[familyId];
    if (pair) {
      for (const [mode, variantId] of Object.entries(pair)) {
        if (!family.variants[variantId]) {
          return {
            ok: false,
            reason: `webPairs.${familyId}.${mode} = "${variantId}" but the manifest has no such variant`,
          };
        }
      }
    }
  }

  return { ok: true, manifest, survivors };
}

/**
 * Collect the WHOLE theme engine -- every family + variant the manifest
 * declares, restricted to what actually has a readable colors.json on disk --
 * as swatch-only data for the /colophon gallery. Unlike `loadThemeSource` (which
 * loads only the curated families and emits CSS), this reads EVERY family,
 * including the dark-only ones the site never lands on, so the gallery can show
 * all 57 variants. No contrast dropping and no CSS: these are decorative
 * swatches, not page text.
 *
 * A family the manifest declares but whose colors.json files are all missing
 * (exactly the shape of the committed vendor snapshot, which lists all 17
 * families but ships colors.json for only the curated 8) is OMITTED and reported
 * through `onWarn`, so a snapshot-fallback build degrades the gallery to
 * curated-only loudly rather than silently.
 *
 * @param {string} dir
 * @param {import('zod').infer<typeof ManifestSchema>} manifest  already-parsed manifest
 * @param {{ onWarn?: (msg: string) => void }} [opts]
 * @returns {{ families: Array<{familyId:string, familyName:string, variants: Array<{id:string, variantId:string, name:string, mode:'light'|'dark', swatch:{bg:string,fg:string,accent:string}}>}>, omitted: string[] }}
 */
export function loadAllFamilies(dir, manifest, { onWarn = () => {} } = {}) {
  const families = [];
  const omitted = [];

  for (const [familyId, family] of Object.entries(manifest.families)) {
    const variants = [];
    for (const [variantId, variantMeta] of Object.entries(family.variants)) {
      const colorsPath = join(dir, 'src/theme', familyId, variantId, 'colors.json');
      if (!existsSync(colorsPath)) continue;

      let raw;
      try {
        raw = JSON.parse(readFileSync(colorsPath, 'utf8'));
      } catch {
        continue;
      }
      const parsed = ColorsSchema.safeParse(raw);
      if (!parsed.success) continue;

      const c = parsed.data;
      variants.push({
        id: `${familyId}-${variantId}`,
        variantId,
        name: variantMeta.display_name,
        mode: variantMeta.mode,
        swatch: { bg: c.bg, fg: c.fg, accent: c.accent },
      });
    }

    if (variants.length === 0) {
      omitted.push(familyId);
      onWarn(
        `themes-all: family "${familyId}" is declared in the manifest but has no readable colors.json in ${dir} -- omitting from the gallery`,
      );
      continue;
    }
    families.push({ familyId, familyName: family.name, variants });
  }

  return { families, omitted };
}
