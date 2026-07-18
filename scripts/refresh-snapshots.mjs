#!/usr/bin/env node
// Refreshes the committed vendor snapshots under src/data/vendor/ from the
// live sources checked out in .sources/ (populated by sync-sources.sh).
// These snapshots are the site's last line of defense: when a sibling repo
// is unreachable (rate-limited API, network blip, repo renamed), the build
// falls back to whatever was last committed here rather than failing.
//
// Usage:
//   node scripts/refresh-snapshots.mjs            # refresh the themes snapshot
//   node scripts/refresh-snapshots.mjs --themes    # (explicit, same as above)
//
// Future `--ghost` etc. flags are anticipated (Task 14) but not implemented yet.

import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadThemeSource } from './lib/theme-source.mjs';
import { SITE } from '../src/site.config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const LIVE_DIR = join(REPO_ROOT, '.sources/dotfiles');
const SNAPSHOT_DIR = join(REPO_ROOT, 'src/data/vendor/themes-snapshot');

function warn(msg) {
  console.log(`::warning::refresh-snapshots: ${msg}`);
}

function error(msg) {
  console.error(`::error::refresh-snapshots: ${msg}`);
}

function refreshThemesSnapshot() {
  if (!existsSync(LIVE_DIR)) {
    error(`live source not found at ${LIVE_DIR} -- run scripts/sync-sources.sh first`);
    process.exit(1);
  }

  // Validate first (brief requirement): don't let a corrupt live checkout
  // clobber a known-good committed snapshot.
  const result = loadThemeSource(LIVE_DIR, {
    curatedFamilies: SITE.curatedFamilies,
    webPairs: SITE.webPairs,
    onWarn: warn,
  });

  if (!result.ok) {
    error(`live source failed validation: ${result.reason} -- refusing to refresh snapshot`);
    process.exit(1);
  }

  if (result.survivors.length < SITE.minCounts.themeVariants) {
    error(
      `only ${result.survivors.length} valid variants in live source (< ${SITE.minCounts.themeVariants} required) -- refusing to refresh snapshot`,
    );
    process.exit(1);
  }

  // Start clean so removed families/variants don't linger as stale files.
  rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  mkdirSync(SNAPSHOT_DIR, { recursive: true });

  // config/themes.json -- copy verbatim (it's already schema-valid).
  mkdirSync(join(SNAPSHOT_DIR, 'config'), { recursive: true });
  copyFileSync(join(LIVE_DIR, 'config/themes.json'), join(SNAPSHOT_DIR, 'config/themes.json'));

  // Curated families' colors.json, preserving src/theme/<family>/<variant>/ layout.
  let count = 0;
  for (const v of result.survivors) {
    const srcPath = join(LIVE_DIR, 'src/theme', v.familyId, v.variantId, 'colors.json');
    const destDir = join(SNAPSHOT_DIR, 'src/theme', v.familyId, v.variantId);
    mkdirSync(destDir, { recursive: true });
    copyFileSync(srcPath, join(destDir, 'colors.json'));
    count++;
  }

  console.log(`refresh-snapshots: wrote ${count} colors.json files across ${SITE.curatedFamilies.length} curated families to ${SNAPSHOT_DIR}`);
}

const args = process.argv.slice(2);
const wantsThemes = args.length === 0 || args.includes('--themes');

if (wantsThemes) {
  refreshThemesSnapshot();
}
