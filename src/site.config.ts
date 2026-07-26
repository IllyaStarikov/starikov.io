// Values live in site.config.mjs (plain JS/JSON-shaped) so that node scripts
// (e.g. scripts/build-themes.mjs, run under plain `node`, no TS loader) and
// Astro/TypeScript code share exactly one source of truth. site.config.mjs
// annotates its export with `/** @type {const} */`, which gives it the same
// literal-narrowed type here as a hand-written `as const` would (a plain
// `as const` cast doesn't apply to a re-exported reference -- TS only allows
// it on literal expressions -- so the narrowing has to happen at the source).
export { SITE } from './site.config.mjs';
export {
  EDITOR_STARTUP,
  ACADEMIA_PDF_ORIGIN,
  PDF_VOLUMES,
  ACADEMIA_THEME_RULES,
  ACADEMIA_THEME_FALLBACK,
  ACADEMIA_THEME_ORDER,
} from './site.config.mjs';
