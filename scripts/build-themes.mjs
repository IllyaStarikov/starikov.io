#!/usr/bin/env node
// Generates the site's entire theme system from the real dotfiles theme engine:
//   .sources/dotfiles/config/themes.json + .../src/theme/<family>/<variant>/colors.json
// ->  src/styles/themes.generated.css   (one [data-theme="fam-var"] block per variant)
//     src/data/generated/themes.json    (manifest consumed by theme-boot.ts, ThemeControl, /colophon)
//
// Source resolution (see task-3 brief + report for the full contract):
//   1. THEMES_SOURCE_DIR env (tests) -- treated as a "live" source; on failure it
//      retries from the vendored snapshot UNLESS THEMES_NO_FALLBACK=1, in which case
//      failure is terminal (used by the corrupt-fixture test to assert exit 1).
//   2. .sources/dotfiles if present (populated by scripts/sync-sources.sh).
//   3. src/data/vendor/themes-snapshot -- the committed fallback (logs a warning).
// Reading the snapshot itself is always terminal: there is nowhere further to fall
// back to, so a corrupt snapshot is a hard build failure (`process.exit(1)`).
//
// Engine-agnostic by design: every knob (curated families, webPairs, minCounts)
// comes from src/site.config.mjs (SITE) -- this script has zero hardcoded theme
// names beyond the CSS property names themselves.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastRatio, deriveTextTokens } from './lib/contrast.mjs';
import { loadThemeSource } from './lib/theme-source.mjs';
import { SITE } from '../src/site.config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const LIVE_DIR = join(REPO_ROOT, '.sources/dotfiles');
const SNAPSHOT_DIR = join(REPO_ROOT, 'src/data/vendor/themes-snapshot');

// THEMES_OUT_DIR (tests only) redirects both outputs under one scratch root
// instead of the real, gitignored src/ paths. Task 5's build-themes.test.mjs
// used to run this script against the real OUT_CSS/OUT_JSON every time the
// suite ran, silently overwriting whatever a real `npm run build` had last
// generated (a two-family fixture in place of the full 8-family curated set)
// -- corrupting local dev state and making test/theme-boot.test.mjs's
// catppuccin-dependent assertion flaky (it has to skipIf(!PAIRS.catppuccin)
// to survive). THEMES_OUT_DIR is how the test now opts out of touching the
// real paths at all; unset (the real build), OUT_CSS/OUT_JSON are unchanged.
const OUT_ROOT = process.env.THEMES_OUT_DIR ?? REPO_ROOT;
const OUT_CSS = join(OUT_ROOT, 'src/styles/themes.generated.css');
const OUT_JSON = join(OUT_ROOT, 'src/data/generated/themes.json');

const MIN_SURVIVING_VARIANTS = SITE.minCounts.themeVariants;

// ---------------------------------------------------------------------------
// Logging helpers (GitHub Actions annotation format; harmless outside CI)
// ---------------------------------------------------------------------------

function warn(msg) {
  console.log(`::warning::themes: ${msg}`);
}

function error(msg) {
  console.error(`::error::themes: ${msg}`);
}

function load(dir) {
  return loadThemeSource(dir, {
    curatedFamilies: SITE.curatedFamilies,
    webPairs: SITE.webPairs,
    onWarn: warn,
  });
}

// ---------------------------------------------------------------------------
// CSS generation
// ---------------------------------------------------------------------------

function cssBlock(id, colors, mode) {
  const { textSecondary, codeComment } = deriveTextTokens(colors.fg, colors.bg);
  const colorScheme = mode === 'light' ? 'light' : 'dark';

  const lines = [
    `[data-theme="${id}"] {`,
    `  color-scheme: ${colorScheme};`,
    `  --bg:${colors.bg}; --fg:${colors.fg}; --surface:${colors.surface}; --border:${colors.border}; --muted:${colors.muted};`,
    `  --accent:${colors.accent}; --accent-alt:${colors.accent_alt}; --selection:${colors.selection_bg};`,
    `  --text-secondary:${textSecondary}; --code-comment:${codeComment};`,
    `  --surface-raised:color-mix(in srgb, var(--surface) 85%, var(--fg));`,
    `  --surface-hover:color-mix(in srgb, var(--bg) 92%, var(--fg));`,
    `  --focus-ring:color-mix(in srgb, var(--accent) 60%, transparent);`,
    `  --ansi-black:${colors.black}; --ansi-red:${colors.red}; --ansi-green:${colors.green}; --ansi-yellow:${colors.yellow}; --ansi-blue:${colors.blue}; --ansi-magenta:${colors.magenta}; --ansi-cyan:${colors.cyan};`,
    `  --ok:var(--ansi-green); --warn:var(--ansi-yellow); --err:var(--ansi-red);`,
    `  --astro-code-foreground:var(--fg); --astro-code-background:var(--surface);`,
    `  --astro-code-token-keyword:var(--ansi-magenta); --astro-code-token-string:var(--ansi-green);`,
    `  --astro-code-token-function:var(--ansi-blue); --astro-code-token-constant:var(--ansi-yellow);`,
    `  --astro-code-token-comment:var(--code-comment);`,
    `  --astro-code-token-parameter:var(--ansi-cyan); --astro-code-token-string-expression:var(--ansi-green);`,
    `  --astro-code-token-punctuation:var(--text-secondary); --astro-code-token-link:var(--ansi-blue);`,
    `}`,
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Dotfiles source sha (best-effort, for provenance -- consumed by /colophon later)
// ---------------------------------------------------------------------------

function readSourceSha(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function resolveInitialSource() {
  const envDir = process.env.THEMES_SOURCE_DIR;
  if (envDir) {
    return { dir: envDir, kind: 'env' };
  }
  if (existsSync(LIVE_DIR)) {
    return { dir: LIVE_DIR, kind: 'live' };
  }
  warn('using vendored snapshot');
  return { dir: SNAPSHOT_DIR, kind: 'snapshot' };
}

function main() {
  const noFallback = process.env.THEMES_NO_FALLBACK === '1';
  const initial = resolveInitialSource();

  let result = load(initial.dir);
  let usedDir = initial.dir;
  let usedKind = initial.kind;

  const survivingCount = () => (result.ok ? result.survivors.length : 0);
  const isTerminalSource = (kind) => kind === 'snapshot' || (kind === 'env' && noFallback);

  if (!result.ok || survivingCount() < MIN_SURVIVING_VARIANTS) {
    const problem = result.ok
      ? `only ${survivingCount()} valid variants survived (< ${MIN_SURVIVING_VARIANTS} required)`
      : result.reason;

    if (isTerminalSource(usedKind)) {
      error(`${problem}; source "${usedDir}" is terminal (no further fallback) -- failing build`);
      process.exit(1);
    }

    warn(`${problem} from "${usedDir}" -- retrying from vendored snapshot`);
    result = load(SNAPSHOT_DIR);
    usedDir = SNAPSHOT_DIR;
    usedKind = 'snapshot';

    if (!result.ok || survivingCount() < MIN_SURVIVING_VARIANTS) {
      const finalProblem = result.ok
        ? `only ${survivingCount()} valid variants survived (< ${MIN_SURVIVING_VARIANTS} required)`
        : result.reason;
      error(`${finalProblem}; vendored snapshot is terminal -- failing build`);
      process.exit(1);
    }
  }

  const { manifest, survivors } = result;

  // Validate every emitted block meets the WCAG AA text floor for fg-on-bg;
  // drop (and warn about) any variant that doesn't.
  const emitted = [];
  for (const v of survivors) {
    const ratio = contrastRatio(v.colors.fg, v.colors.bg);
    if (ratio < 4.5) {
      warn(`${v.familyId}/${v.variantId}: fg/bg contrast ${ratio.toFixed(2)} < 4.5 -- dropping variant`);
      continue;
    }
    emitted.push(v);
  }

  if (emitted.length < MIN_SURVIVING_VARIANTS) {
    error(
      `only ${emitted.length} variants passed contrast validation (< ${MIN_SURVIVING_VARIANTS} required) from "${usedDir}"`,
    );
    process.exit(1);
  }

  // ---- Group survivors by family, in SITE.curatedFamilies order ----------
  const byFamily = new Map();
  for (const v of emitted) {
    if (!byFamily.has(v.familyId)) byFamily.set(v.familyId, []);
    byFamily.get(v.familyId).push(v);
  }

  const cssBlocks = [];
  const families = [];

  for (const familyId of SITE.curatedFamilies) {
    const variants = byFamily.get(familyId);
    if (!variants || variants.length === 0) continue;

    const pair = SITE.webPairs[familyId];
    if (!pair) {
      error(`curated family "${familyId}" has no entry in SITE.webPairs`);
      process.exit(1);
    }

    const findVariant = (variantId) => variants.find((v) => v.variantId === variantId);
    const lightVariant = findVariant(pair.light);
    const darkVariant = findVariant(pair.dark);
    if (!lightVariant || !darkVariant) {
      error(
        `family "${familyId}": webPair variant "${!lightVariant ? pair.light : pair.dark}" did not survive validation`,
      );
      process.exit(1);
    }

    const variantEntries = [];
    for (const v of variants) {
      const id = `${familyId}-${v.variantId}`;
      cssBlocks.push(cssBlock(id, v.colors, v.mode));
      variantEntries.push({
        id,
        variantId: v.variantId,
        name: v.displayName,
        mode: v.mode,
        swatch: { bg: v.colors.bg, fg: v.colors.fg, accent: v.colors.accent },
      });
    }

    families.push({
      id: familyId,
      name: variants[0].familyName,
      pair: { light: `${familyId}-${pair.light}`, dark: `${familyId}-${pair.dark}` },
      variants: variantEntries,
    });
  }

  // ---- Defaults: derived from the manifest's default family, constrained to
  //      our own curated + webPairs set so it always points at an id we
  //      actually emitted. ----
  const defaultFamilyRaw = manifest.defaults.dark.slice(0, manifest.defaults.dark.indexOf('_'));
  const defaultFamily = SITE.curatedFamilies.includes(defaultFamilyRaw)
    ? defaultFamilyRaw
    : SITE.curatedFamilies[0];
  const defaultPair = SITE.webPairs[defaultFamily];

  const themesJson = {
    defaults: {
      light: `${defaultFamily}-${defaultPair.light}`,
      dark: `${defaultFamily}-${defaultPair.dark}`,
    },
    families,
    meta: {
      sourceSha: usedKind === 'live' || usedKind === 'env' ? readSourceSha(usedDir) : null,
      source: usedKind,
      generatedAt: new Date().toISOString(),
      // Total emitted variants across every family -- Task 15's
      // scripts/validate-dist.mjs reads THIS (not counts.json) for the
      // `minCounts.themeVariants` gate, since theme generation is a separate
      // build step from the content-collection loaders counts.json covers.
      variantCount: emitted.length,
    },
  };

  // ---- Write outputs -------------------------------------------------------
  mkdirSync(dirname(OUT_CSS), { recursive: true });
  mkdirSync(dirname(OUT_JSON), { recursive: true });

  const cssOut = `/* AUTO-GENERATED by scripts/build-themes.mjs. Do not edit by hand. Source: ${usedDir}. */\n\n${cssBlocks.join('\n\n')}\n`;
  writeFileSync(OUT_CSS, cssOut);
  writeFileSync(OUT_JSON, JSON.stringify(themesJson, null, 2) + '\n');

  const cssKb = (Buffer.byteLength(cssOut, 'utf8') / 1024).toFixed(1);
  console.log(`themes: ${families.length} families, ${emitted.length} variants, css ${cssKb} KB`);
}

main();
