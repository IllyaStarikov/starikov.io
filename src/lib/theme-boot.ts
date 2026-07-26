/*
 * The pre-paint theme boot script (the signature "no flash" moment).
 *
 * THEME_BOOT_SRC is a self-contained IIFE, emitted verbatim as a blocking
 * `<script is:inline data-astro-rerun>` in the document head (see Base.astro).
 * It runs before first paint, resolves the visitor's theme from localStorage
 * (or the OS scheme in `system` mode), and stamps `data-theme` on <html> plus
 * the `<meta name="theme-color">` value -- so the correct palette is in place
 * the instant the browser paints, and re-applied after every ClientRouter swap.
 *
 * The script embeds three build-time constants (from src/data/generated/themes.json):
 *   P   family id -> { light, dark } variant *suffix* ids   (resolver table)
 *   D   { family } default family                           (fallback anchor)
 *   BG  full theme id -> bg hex                              (theme-color, no
 *                                                             getComputedStyle race)
 * The raw objects are exported too so the resolver logic can be unit-tested.
 *
 * `data-mode` (Task 2, v1.1 polish, design D6): alongside `data-theme`, `apply()`
 * also stamps `data-mode="light"|"dark"` on <html> -- the resolved MODE, not the
 * full "<family>-<variant>" id. `data-theme`'s variant suffixes aren't
 * consistently named (`storm`, `mocha`, `dark_dimmed`, …), so no plain CSS
 * attribute selector can reliably tell light from dark off it alone; components
 * that need to render differently by the SITE's theme mode instead of the OS
 * scheme (e.g. ProfileCard.astro's light/dark card) key off `[data-mode]`.
 * Recomputed on every apply() call, so it tracks family switches, explicit
 * mode changes, OS-scheme flips while in system mode, and post-swap
 * re-application -- the same single resolver, one extra attribute.
 */
import themesData from '../data/generated/themes.json';

type Mode = 'light' | 'dark';
export type Pair = Record<Mode, string>;
export type Pairs = Record<string, Pair>;
export interface Defaults {
  family: string;
}

// family id -> { light: variantSuffix, dark: variantSuffix } (e.g. { light: 'day', dark: 'storm' }).
const PAIRS: Pairs = {};
// full theme id -> bg hex, only for the paired (resolvable) variants the boot can land on.
const BG: Record<string, string> = {};

for (const family of themesData.families) {
  const byId = new Map(family.variants.map((v) => [v.id, v]));
  const lightVar = byId.get(family.pair.light);
  const darkVar = byId.get(family.pair.dark);
  // build-themes guarantees both, but stay defensive rather than emit a broken map.
  if (!lightVar || !darkVar) continue;
  PAIRS[family.id] = { light: lightVar.variantId, dark: darkVar.variantId };
  BG[lightVar.id] = lightVar.swatch.bg;
  BG[darkVar.id] = darkVar.swatch.bg;
}

// Derive the default family by locating which family owns the default dark id,
// rather than string-splitting on '-' (variant ids can contain separators).
function familyOf(fullId: string): string {
  for (const family of themesData.families) {
    if (family.variants.some((v) => v.id === fullId)) return family.id;
  }
  return themesData.families[0].id;
}

const DEFAULTS: Defaults = { family: familyOf(themesData.defaults.dark) };

/**
 * Build the inline boot IIFE from a pairs/defaults/bg triple. Kept pure (all
 * data injected) so tests can drive the resolver with controlled fixtures.
 */
export function buildBootSrc(pairs: Pairs, defaults: Defaults, bg: Record<string, string>): string {
  const P = JSON.stringify(pairs);
  const D = JSON.stringify(defaults);
  const B = JSON.stringify(bg);
  // Runs pre-paint AND on every re-execution (data-astro-rerun re-runs it per swap).
  // Listener registration is guarded by a window flag so swaps don't stack duplicates.
  // resolve() hardening (Task 17): only "light"/"dark" are honored as explicit
  // modes; "system", empty, null AND any corrupt string all fall through to the
  // OS scheme. Coercing here means P[fam][mode] can never key on a bogus mode and
  // emit a "<family>-undefined" attribute.
  return `(function(){var P=${P},D=${D},BG=${B},LM;function resolve(f,m){var sysDark=matchMedia("(prefers-color-scheme: dark)").matches;var mode=(m==="light"||m==="dark")?m:(sysDark?"dark":"light");LM=mode;var fam=P[f]?f:D.family;var v=(P[fam]&&P[fam][mode])||P[D.family][mode];return fam+"-"+v;}function apply(){var f,m;try{f=localStorage.getItem("theme:family");m=localStorage.getItem("theme:mode");}catch(e){}var t=resolve(f||D.family,m||"system");document.documentElement.dataset.theme=t;document.documentElement.dataset.mode=LM;var meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.setAttribute("content",BG[t]||"");}apply();window.__applyTheme=apply;if(!window.__themeBooted){window.__themeBooted=true;try{matchMedia("(prefers-color-scheme: dark)").addEventListener("change",function(){var m;try{m=localStorage.getItem("theme:mode");}catch(e){}if((m||"system")==="system")apply();});}catch(e){}document.addEventListener("astro:after-swap",apply);}})();`;
}

const THEME_BOOT_SRC = buildBootSrc(PAIRS, DEFAULTS, BG);

export { BG, DEFAULTS, PAIRS, THEME_BOOT_SRC };
