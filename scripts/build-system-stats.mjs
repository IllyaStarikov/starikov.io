#!/usr/bin/env node
// Generates the live numbers SystemCard.astro's `editor`/`dotfiles` rows print
// (design spec §5.2; v1.1 polish Task 6 "SystemCard live stats", A10+A11):
//   .sources/dotfiles -> src/data/generated/system-stats.json
//
// Source resolution mirrors scripts/build-themes.mjs's contract exactly:
//   1. SYSTEM_STATS_SOURCE_DIR env (tests) -- a dir classified git-or-fs the
//      same way as step 2 below, never treated specially.
//   2. .sources/dotfiles if present -- CI's sparse actions/checkout (with a
//      real .git: sparse-checkout limits the WORKTREE, not the fetch, so
//      `git ls-files`/`git grep --cached` still see the FULL tracked tree
//      regardless of which paths were actually checked out to disk -- no
//      `filter:` is set on that checkout, verified against deploy.yml), or a
//      local `scripts/sync-sources.sh` copy (an rsync with no .git).
//   3. the committed src/data/vendor/system-stats-snapshot.json.
//   4. a hardcoded in-code default, if even the snapshot is unreadable.
//
// Counting, once a source dir is resolved:
//   - WITH .git: `git ls-files | wc -l` for the file count, `git grep -I
//     --cached -c '' | awk -F: '{s+=$2} END{print s}'` for the line count --
//     the git DATABASE, so this is accurate even against a sparse worktree.
//   - WITHOUT .git: a plain filesystem walk, with a NUL-byte-in-the-first-8KB
//     heuristic standing in for git grep -I's own binary-file detection.
//
// Unlike build-themes.mjs, this script NEVER hard-fails: SystemCard's numbers
// are flavor, not load-bearing infrastructure (the theme engine IS), so every
// failure mode -- checkout absent, git/fs commands erroring, even a corrupt
// snapshot -- warns and falls through to the next tier instead of exiting 1.
//
// Emits gitignored src/data/generated/system-stats.json:
//   { pluginCount, dotfilesFiles, dotfilesLines, dotfilesLinesLabel,
//     source: "git"|"fs"|"snapshot", measured: string|null, generatedAt }
//
// `measured` (v1.1 polish Task 6 fix round 1, Finding 2) is the committed
// snapshot's own dated provenance (system-stats-snapshot.json's `measured`
// field) -- non-null ONLY when the 'snapshot' tier actually read that file.
// It is null (never omitted -- the key is ALWAYS present so downstream JSON-
// module type inference sees a stable shape regardless of which tier last
// ran locally) for the git/fs tiers (fresh counts have no "measured" date to
// name) and for the double-failure HARDCODED_FALLBACK tier (no file was
// actually read, so there is no honest date to cite either).
// src/pages/colophon.astro reads this + `source` so the Provenance section
// never claims "computed fresh at build" for a number that fell back.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const LIVE_DIR = join(REPO_ROOT, '.sources/dotfiles');
const SNAPSHOT_PATH = process.env.SYSTEM_STATS_SNAPSHOT_PATH
  ?? join(REPO_ROOT, 'src/data/vendor/system-stats-snapshot.json');
// SYSTEM_STATS_OUT_DIR (tests only): redirects the output under a scratch
// root instead of the real, gitignored src/data/generated/ path -- mirrors
// build-themes.mjs's THEMES_OUT_DIR for exactly the same reason (a test run
// must never clobber a real local `npm run build`'s output).
const OUT_ROOT = process.env.SYSTEM_STATS_OUT_DIR ?? REPO_ROOT;
const OUT_JSON = join(OUT_ROOT, 'src/data/generated/system-stats.json');

const LOCK_RELATIVE = 'src/neovim/lazy-lock.json';

// Absolute last resort -- only reached if even the committed snapshot fails
// to parse (should never happen in practice: test/build-system-stats.test.mjs
// pins the real snapshot's shape). Kept roughly in sync with that file's
// committed values by hand; the snapshot itself carries the honest "measured"
// provenance date, this constant deliberately does not.
const HARDCODED_FALLBACK = { pluginCount: 52, dotfilesFiles: 770, dotfilesLines: 116802 };

function warn(msg) {
  console.log(`::warning::system-stats: ${msg}`);
}

// ---------------------------------------------------------------------------
// Pure helpers -- exported for direct unit tests (test/build-system-stats.test.mjs)
// ---------------------------------------------------------------------------

/**
 * Sums the per-file counts out of `git grep -I --cached -c ''` output (one
 * "path:N" line per matching file -- a path may itself contain ":", so each
 * line is split on its LAST colon, not its first). Blank lines are skipped.
 * PURE.
 */
export function sumGrepCounts(output) {
  let sum = 0;
  for (const line of output.split('\n')) {
    if (!line) continue;
    const idx = line.lastIndexOf(':');
    if (idx === -1) continue;
    const n = Number(line.slice(idx + 1));
    if (Number.isFinite(n)) sum += n;
  }
  return sum;
}

/** "116802" -> "116.8K" -- mirrors the site's existing "90.8K lines" style
 *  (one decimal place, K suffix). Below 1000, the plain rounded integer. PURE. */
export function formatLinesLabel(n) {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) < 1000) return String(Math.round(n));
  return `${(n / 1000).toFixed(1)}K`;
}

/**
 * lazy-lock.json's top-level shape is `{"plugin-name": {...}, ...}` -- one key
 * per locked plugin (lazy.nvim's own format). Throws on anything else (a
 * malformed file or a lockfile format change), which the caller treats as
 * "counting failed" -> fall back a tier rather than print a wrong count. PURE.
 */
export function countPluginsFromLockData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('lazy-lock.json is not a {name: {...}} object');
  }
  return Object.keys(data).length;
}

/** git grep -I's own heuristic, reimplemented for the no-.git fs-walk path: a
 *  NUL byte anywhere in the first 8KB (the common binary-sniff window) means
 *  binary -- excluded from the line count (but still counted as a file). PURE. */
export function isBinaryChunk(buf) {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/** Line count matching `git grep -c`'s own notion of a file's line count
 *  (verified empirically -- NOT the same as `wc -l`, which counts '\n' bytes
 *  and so reports 0 for a one-line file with no trailing newline): every
 *  '\n' is a line break, AND a final unterminated line (no trailing '\n')
 *  still counts once; an empty file is 0 lines. PURE. */
export function countLinesInText(text) {
  if (text.length === 0) return 0;
  const parts = text.split('\n');
  return text.endsWith('\n') ? parts.length - 1 : parts.length;
}

/** Validates the shape system-stats-snapshot.json (and HARDCODED_FALLBACK)
 *  must have, returning just the three counted fields. Throws on anything
 *  else. PURE. */
export function validateSnapshotShape(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('snapshot is not an object');
  for (const key of ['pluginCount', 'dotfilesFiles', 'dotfilesLines']) {
    if (typeof raw[key] !== 'number' || !Number.isFinite(raw[key])) {
      throw new Error(`snapshot.${key} is not a finite number`);
    }
  }
  return { pluginCount: raw.pluginCount, dotfilesFiles: raw.dotfilesFiles, dotfilesLines: raw.dotfilesLines };
}

/**
 * Extracts the snapshot's own `measured` provenance date (validateSnapshotShape
 * deliberately drops it -- that function is pinned to just the three counted
 * fields). Returns it only when it's actually a "YYYY-MM-DD"-shaped string;
 * `null` for anything else (absent, wrong type, malformed) -- colophon.astro's
 * dated-snapshot wording must never print a fabricated or garbled date. PURE.
 */
export function readSnapshotMeasured(raw) {
  if (raw && typeof raw === 'object' && typeof raw.measured === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.measured)) {
    return raw.measured;
  }
  return null;
}

// ---------------------------------------------------------------------------
// IO: git-database counting (a checkout WITH .git -- CI, or a full local clone)
// ---------------------------------------------------------------------------

function gitFileCount(dir) {
  const out = execFileSync('git', ['-C', dir, 'ls-files'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return out.split('\n').filter(Boolean).length;
}

function gitLineCount(dir) {
  try {
    const out = execFileSync('git', ['-C', dir, 'grep', '-I', '--cached', '-c', ''], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return sumGrepCounts(out);
  } catch (err) {
    // `git grep` exits 1 (not an error -- "no matches") when the tree has no
    // trackable text file at all. Any OTHER exit (not a repo, git missing,
    // …) is a real failure and propagates to the caller's fallback tier.
    if (err && err.status === 1) return 0;
    throw err;
  }
}

function readPluginCount(dir) {
  const raw = JSON.parse(readFileSync(join(dir, LOCK_RELATIVE), 'utf8'));
  return countPluginsFromLockData(raw);
}

function countViaGit(dir) {
  return {
    pluginCount: readPluginCount(dir),
    dotfilesFiles: gitFileCount(dir),
    dotfilesLines: gitLineCount(dir),
    source: 'git',
  };
}

// ---------------------------------------------------------------------------
// IO: filesystem walk (a local sync-sources.sh copy -- no .git)
// ---------------------------------------------------------------------------

function walkFs(root) {
  let files = 0;
  let lines = 0;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable dir (permissions, a race) -- skip, don't fail the walk
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue; // never follow -- avoid cycles/dangling links
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      files += 1;
      try {
        const buf = readFileSync(full);
        if (!isBinaryChunk(buf)) lines += countLinesInText(buf.toString('utf8'));
      } catch {
        // unreadable file -- still counted as a file, just contributes 0 lines
      }
    }
  }
  return { files, lines };
}

function countViaFs(dir) {
  const { files, lines } = walkFs(dir);
  return {
    pluginCount: readPluginCount(dir),
    dotfilesFiles: files,
    dotfilesLines: lines,
    source: 'fs',
  };
}

// ---------------------------------------------------------------------------
// Resolution + fallback cascade
// ---------------------------------------------------------------------------

function resolveDir() {
  return process.env.SYSTEM_STATS_SOURCE_DIR || LIVE_DIR;
}

/** Absent checkout, or any counting failure within it (bad git state, a
 *  missing/corrupt lazy-lock.json, …), both warn and return null -- the
 *  caller falls back to the committed snapshot. Never throws. */
function countFromCheckout(dir) {
  if (!existsSync(dir)) {
    warn(`no dotfiles checkout at "${dir}"; falling back to the committed snapshot`);
    return null;
  }
  try {
    return existsSync(join(dir, '.git')) ? countViaGit(dir) : countViaFs(dir);
  } catch (err) {
    warn(`counting against "${dir}" failed (${err.message}); falling back to the committed snapshot`);
    return null;
  }
}

/** The committed snapshot, or -- if even THAT is unreadable -- the hardcoded
 *  in-code default. Never throws: this is the guaranteed-to-succeed last
 *  tier of the cascade. */
function countFromSnapshot() {
  try {
    const raw = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
    return { ...validateSnapshotShape(raw), source: 'snapshot', measured: readSnapshotMeasured(raw) };
  } catch (err) {
    warn(`committed snapshot at "${SNAPSHOT_PATH}" unusable (${err.message}); using hardcoded last-resort defaults`);
    // No file was actually read here, so there's no honest date to cite --
    // `measured` stays null, same as the git/fs tiers (see readSnapshotMeasured).
    return { ...HARDCODED_FALLBACK, source: 'snapshot', measured: null };
  }
}

function main() {
  const dir = resolveDir();
  const result = countFromCheckout(dir) ?? countFromSnapshot();

  const out = {
    pluginCount: result.pluginCount,
    dotfilesFiles: result.dotfilesFiles,
    dotfilesLines: result.dotfilesLines,
    dotfilesLinesLabel: formatLinesLabel(result.dotfilesLines),
    source: result.source,
    // Always present (never omitted) so this JSON's shape -- and therefore
    // what TypeScript infers for consumers like colophon.astro that import
    // it as a module -- is stable regardless of which cascade tier last ran
    // locally. countViaGit/countViaFs results carry no `measured` field at
    // all, so `result.measured` is `undefined` there; `?? null` normalizes
    // that to the same "no date" value countFromSnapshot's own tiers use.
    measured: result.measured ?? null,
    generatedAt: new Date().toISOString(),
  };

  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + '\n');

  console.log(
    `system-stats: ${out.pluginCount} plugins, ${out.dotfilesFiles} files, ${out.dotfilesLinesLabel} lines (source: ${out.source})`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
