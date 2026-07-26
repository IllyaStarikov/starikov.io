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
//   node scripts/refresh-snapshots.mjs --ghost     # re-stamp the ghost snapshot's provenance
//
// NOT wired into CI or `npm run build` (v1.1 polish Task 6 brief, A12) --
// refreshing a vendor snapshot is a deliberate, human-run action (a real
// content update, or a "yes, re-verify this"), never an automatic build step.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadThemeSource } from './lib/theme-source.mjs';
import { SITE } from '../src/site.config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const LIVE_DIR = join(REPO_ROOT, '.sources/dotfiles');
const SNAPSHOT_DIR = join(REPO_ROOT, 'src/data/vendor/themes-snapshot');
const GHOST_SNAPSHOT_PATH = join(REPO_ROOT, 'src/data/vendor/ghost-snapshot.json');
const GHOST_SNAPSHOT_META_PATH = join(REPO_ROOT, 'src/data/vendor/ghost-snapshot-meta.json');

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

/**
 * Re-stamps ghost-snapshot-meta.json's `fetchedAt` to "now" -- the honest
 * provenance date /writing's footer shows ("essay index from snapshot ·
 * synced <date>") whenever a build's shared Ghost fetch (src/loaders/
 * ghost.ts) falls back off live.
 *
 * Unlike refreshThemesSnapshot() above, this does NOT itself re-fetch content
 * from Ghost -- there is no `.sources/`-style local checkout for a remote
 * Content API to copy from, and GHOST_CONTENT_API_KEY isn't configured in
 * this environment to verify a real fetch-and-write path against (see
 * ghost.ts's module doc: "no Content API key exists yet"). This command's
 * contract is narrower and honest about that: it assumes
 * src/data/vendor/ghost-snapshot.json's CONTENT has already been refreshed by
 * whatever process does that (a future task, or a manual pull against the
 * Content API), validates that file still looks like a real {posts, tags}
 * snapshot, and only then re-stamps the sidecar to the moment of refresh --
 * so the meta file's date never drifts further from reality than "whenever
 * this command was last run after a real content update."
 */
function refreshGhostSnapshotMeta() {
  if (!existsSync(GHOST_SNAPSHOT_PATH)) {
    error(`${GHOST_SNAPSHOT_PATH} not found -- nothing to stamp`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(GHOST_SNAPSHOT_PATH, 'utf8'));
  } catch (err) {
    error(`${GHOST_SNAPSHOT_PATH} failed to parse: ${err.message} -- refusing to stamp a meta file next to a corrupt snapshot`);
    process.exit(1);
  }
  if (!Array.isArray(parsed?.posts) || !Array.isArray(parsed?.tags)) {
    error(`${GHOST_SNAPSHOT_PATH} does not look like a {posts, tags} snapshot -- refusing to stamp`);
    process.exit(1);
  }

  const fetchedAt = new Date().toISOString();
  writeFileSync(GHOST_SNAPSHOT_META_PATH, JSON.stringify({ fetchedAt }, null, 2) + '\n');
  console.log(
    `refresh-snapshots: stamped ${GHOST_SNAPSHOT_META_PATH} with fetchedAt=${fetchedAt} ` +
      `(${parsed.posts.length} posts, ${parsed.tags.length} tags in the snapshot it describes)`,
  );
}

const args = process.argv.slice(2);
const wantsThemes = args.length === 0 || args.includes('--themes');
const wantsGhost = args.includes('--ghost');

if (wantsThemes) {
  refreshThemesSnapshot();
}
if (wantsGhost) {
  refreshGhostSnapshotMeta();
}
