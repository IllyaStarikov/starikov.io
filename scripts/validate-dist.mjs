#!/usr/bin/env node
/*
 * validate-dist.mjs -- Task 15's hard build gates. Runs LAST in `npm run
 * build` (after build-themes, transcode-media, astro build), against the
 * already-built `dist/` tree plus the counts manifest the content loaders
 * wrote via `report.count()` (src/data/generated/counts.json, assembled by
 * scripts/lib/counts-integration.mjs's astro:build:done hook) and the
 * generated theme manifest (src/data/generated/themes.json). The whole point
 * of this script: a half-empty site (missing tool pages, an essay index that
 * silently rendered empty, a theme system that lost its curated set) can
 * never reach `actions/deploy-pages` -- it fails the build first, loudly.
 *
 * Two tiers of check, matching the brief exactly:
 *
 *   UNCONDITIONAL (fail the build every time, online or offline, CI or a
 *   laptop): does every tools entry have a real dist/bin/<slug>/ page; does
 *   dist/writing/index.html actually contain >= minCounts.essays links out;
 *   did the curated theme CSS actually ship (the --code-comment sentinel);
 *   does sitemap-index.xml exist; does dist/pagefind/ exist WHEN the
 *   pagefind integration is wired up (Task 16 -- feature-flagged by grepping
 *   astro.config.mjs for now, since the integration doesn't exist yet); is
 *   dist/CNAME present and pointed at the real origin. These are pure build
 *   correctness -- nothing here should ever depend on network access, so
 *   there is no "offline dev build" excuse for any of them being broken.
 *
 *   BUILD_STRICT-gated (network + content-threshold gates, CI-only by
 *   default so an offline/WIP local build isn't blocked): the four academia
 *   PDF volumes HEAD -> 200, and SITE.minCounts vs the real counts (tools +
 *   essays from counts.json, themeVariants from themes.json's meta, projects
 *   by globbing src/content/projects/*.mdx minus `draft: true` -- build-
 *   independent, so it doesn't need dist/ or a loader to have counted it).
 *
 * Every pure decision below (occurrences/compareSlugs/withNote/toolsCheckRow/
 * anyContains/pagefindEnabled/isDraftFrontmatter/cnameMatchesOrigin/
 * checkMinCounts/formatSummaryTable/annotationLine/checkUrls) is exported and
 * unit-tested in test/validate-dist.test.mjs with plain data -- no real
 * dist/, no network (checkUrls takes an INJECTED head-check function; main()'s
 * real run is the only place a real `fetch` appears). main() itself is the
 * thin, untested-by-design IO shell around them, mirroring build-themes.mjs /
 * transcode-media.mjs's split.
 *
 * Every counts.json entry (tools/academiaShowcase/courses/repos/essays/
 * essayTags) may carry a `note` -- a loader's provenance hint for a ZERO
 * count (see report.ts's CollectionCount) written on every early-return/catch
 * path, e.g. "source checkout not found at .sources/bin". withNote()/
 * toolsCheckRow() fold it into whichever check row that collection's count
 * feeds, so a genuinely-missing source reads as exactly that, not as a
 * generic "count too low" or a misleadingly renderer-shaped "missing HTML"
 * message (Task 15 code-review finding, reproduced by renaming .sources/bin
 * away and rebuilding without cleaning first -- see the gate-proof
 * reproduction transcript in task-15-report.md).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE, ACADEMIA_PDF_ORIGIN, PDF_VOLUMES } from '../src/site.config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const DIST = join(REPO_ROOT, 'dist');

// ---------------------------------------------------------------------------
// Pure helpers -- see test/validate-dist.test.mjs
// ---------------------------------------------------------------------------

/** Count of non-overlapping occurrences of `needle` in `haystack`. PURE. */
export function occurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

/**
 * Diffs two slug lists (order-insensitive): entries in `expected` but not
 * `actual` are "missing" (the manifest promised a page that isn't on disk);
 * entries in `actual` but not `expected` are "extra" (a page exists nobody
 * accounted for). Both sorted for a deterministic report. PURE.
 */
export function compareSlugs(expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = [...expectedSet].filter((s) => !actualSet.has(s)).sort();
  const extra = [...actualSet].filter((s) => !expectedSet.has(s)).sort();
  return { missing, extra };
}

/**
 * Appends a parenthesized provenance note to a detail string when one is
 * given, else returns the string unchanged. Task 15 code-review finding: a
 * bare "0 < 1" or "missing HTML for: X" reads like a rendering defect; the
 * note (report.ts's CollectionCount.note, set by a loader's early-return/
 * catch path) names the actual root cause -- e.g. "source checkout not found
 * at .sources/bin" -- so the row that fails IS the explanation, not just a
 * symptom. PURE.
 */
export function withNote(text, note) {
  return note ? `${text} (${note})` : text;
}

/**
 * Builds the "tools HTML" check row from counts.json's `tools` entry (may be
 * undefined -- a collection missing from the manifest entirely, which
 * shouldn't happen now that every loader path calls report.count(), but
 * checkMinCounts-style treats it as an empty collection rather than
 * crashing) and the slugs actually found under dist/bin/. Any provenance
 * note on the counts entry (see withNote) is folded into the detail text
 * regardless of pass/fail, so even a vacuous "0/0 slugs present" pass still
 * surfaces WHY there were zero to check. PURE.
 */
export function toolsCheckRow(toolsEntry, distSlugs) {
  const expected = toolsEntry?.slugs ?? [];
  const count = toolsEntry?.count ?? 0;
  const note = toolsEntry?.note;
  const { missing, extra } = compareSlugs(expected, distSlugs);
  if (missing.length === 0) {
    return {
      status: 'pass',
      detail: withNote(`${expected.length}/${expected.length} slugs present in dist/bin/`, note),
      extra,
    };
  }
  return {
    status: 'fail',
    detail: withNote(
      `dist/bin/ is missing HTML for: ${missing.join(', ')} (counts.json lists ${count} tool(s))`,
      note,
    ),
    extra,
  };
}

/** True when any string in `texts` contains `needle`. PURE. */
export function anyContains(texts, needle) {
  return texts.some((t) => t.includes(needle));
}

/**
 * Task 16 feature flag: dist/pagefind/ is only required once astro.config.mjs
 * actually wires up a pagefind integration. Until then this returns false and
 * the caller skips the check with a note instead of failing on something not
 * built yet. PURE (given the config file's source text).
 */
export function pagefindEnabled(astroConfigSource) {
  return /pagefind/i.test(astroConfigSource);
}

/** True when an MDX file's frontmatter sets `draft: true`. PURE. */
export function isDraftFrontmatter(mdxSource) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(mdxSource);
  if (!fm) return false;
  return /^draft:\s*true\s*$/m.test(fm[1]);
}

/** True when a dist/CNAME's content is exactly the site origin's hostname. PURE. */
export function cnameMatchesOrigin(content, originUrl) {
  const trimmed = content.trim();
  if (!trimmed) return false;
  return trimmed === new URL(originUrl).hostname;
}

/**
 * The min-counts hard gate. Returns one entry per key whose `actual` is below
 * `min`'s, sorted by key for a deterministic report -- `[]` means every gate
 * passed. A key absent from `actual` counts as 0 (an uncounted collection is
 * as bad as an empty one). `notes` (optional, keyed the same as `min`) folds
 * a provenance hint onto a failing entry when the caller has one (counts.
 * json's per-collection `note` -- see withNote); a key with no note gets no
 * `note` property at all, so the brief's exact gate-proof shape
 * (`{key:'essays', actual:94, min:99999}`, no `note` key) is unchanged when
 * nothing is known beyond the bare numbers. PURE.
 */
export function checkMinCounts(actual, min, notes = {}) {
  return Object.keys(min)
    .filter((key) => (actual[key] ?? 0) < min[key])
    .sort()
    .map((key) => {
      const entry = { key, actual: actual[key] ?? 0, min: min[key] };
      return notes[key] ? { ...entry, note: notes[key] } : entry;
    });
}

/**
 * `::error::`/`::warning::` GitHub annotation formatting, deliberately
 * independent of src/loaders/lib/report.ts's own GITHUB_ACTIONS-only gate:
 * validate-dist wants the SAME annotation format both in real CI and when a
 * developer runs `BUILD_STRICT=1 npm run build` locally to dry-run the gate
 * (Task 15's brief step 2 gate-proof), so the caller decides `useAnnotations`
 * as `GITHUB_ACTIONS || BUILD_STRICT`, not GITHUB_ACTIONS alone. PURE.
 */
export function annotationLine(useAnnotations, level, source, msg) {
  if (useAnnotations) return `::${level}::${source}: ${msg}`;
  return `${source}: ${level.toUpperCase()}: ${msg}`;
}

/** A GitHub-Flavored-Markdown summary table, one row per check. Always
 *  printed (and written to $GITHUB_STEP_SUMMARY when set) so a build's gate
 *  results are legible even when every check passed. PURE. */
export function formatSummaryTable(rows) {
  const header = '| Check | Status | Detail |\n| --- | --- | --- |';
  const body = rows.map((r) => `| ${r.name} | ${r.status} | ${r.detail} |`).join('\n');
  return body ? `${header}\n${body}\n` : `${header}\n`;
}

/**
 * HEAD-checks every URL through an INJECTED `head(url)` function (never a
 * real `fetch` in tests -- see the module doc). `head` is expected to resolve
 * `{ok, status}` (mirroring the Fetch API's Response) or throw/reject on a
 * network failure. Every URL is checked independently: one failure never
 * skips the rest, so the report always names every failing volume, not just
 * the first.
 */
export async function checkUrls(urls, head) {
  return Promise.all(
    urls.map(async (url) => {
      try {
        const res = await head(url);
        return res.ok ? { url, ok: true, status: res.status } : { url, ok: false, status: res.status };
      } catch (err) {
        return { url, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// IO shell -- main()
// ---------------------------------------------------------------------------

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Directory names under dist/bin/ that are actual tool pages, i.e. every
 *  entry EXCEPT the index.html page itself. */
function toolSlugsInDist() {
  const binDir = join(DIST, 'bin');
  if (!existsSync(binDir)) return [];
  return readdirSync(binDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function projectCountFromSource() {
  const dir = join(REPO_ROOT, 'src/content/projects');
  if (!existsSync(dir)) return 0;
  return readdirSync(dir)
    .filter((f) => f.endsWith('.mdx'))
    .filter((f) => !isDraftFrontmatter(readFileSync(join(dir, f), 'utf8'))).length;
}

async function main() {
  const strict = process.env.BUILD_STRICT === '1';
  const ci = Boolean(process.env.GITHUB_ACTIONS);
  const useAnnotations = ci || strict;

  const rows = [];
  let hardFailure = false;

  function pass(name, detail) {
    rows.push({ name, status: 'pass', detail });
  }
  function fail(name, source, detail) {
    rows.push({ name, status: 'fail', detail });
    hardFailure = true;
    console.error(annotationLine(useAnnotations, 'error', source, detail));
  }
  function warnSkip(name, source, detail) {
    rows.push({ name, status: 'skip', detail });
    console.warn(annotationLine(useAnnotations, 'warning', source, detail));
  }

  // ---- counts.json + themes.json meta -------------------------------------
  const countsPath = join(REPO_ROOT, 'src/data/generated/counts.json');
  const counts = existsSync(countsPath) ? readJson(countsPath) : {};
  const themesPath = join(REPO_ROOT, 'src/data/generated/themes.json');
  const themeVariantCount = existsSync(themesPath) ? (readJson(themesPath).meta?.variantCount ?? 0) : 0;
  const projectCount = projectCountFromSource();

  // ---- 1. per-tool HTML exists for every tools entry (unconditional) ------
  const toolsRow = toolsCheckRow(counts.tools, toolSlugsInDist());
  if (toolsRow.status === 'pass') {
    pass('tools HTML', toolsRow.detail);
  } else {
    fail('tools HTML', 'validate-dist', toolsRow.detail);
  }
  if (toolsRow.extra.length > 0) {
    warnSkip(
      'tools HTML',
      'validate-dist',
      `dist/bin/ has unexpected extra page(s): ${toolsRow.extra.join(', ')}`,
    );
  }

  // ---- 2. /writing/ has >= minCounts.essays links out (unconditional) -----
  const writingPath = join(DIST, 'writing/index.html');
  const essaysNote = counts.essays?.note;
  if (existsSync(writingPath)) {
    const n = occurrences(readFileSync(writingPath, 'utf8'), 'starikov.co/');
    if (n >= SITE.minCounts.essays) {
      pass(
        'writing essay links',
        withNote(`${n} occurrences of "starikov.co/" (>= ${SITE.minCounts.essays})`, essaysNote),
      );
    } else {
      fail(
        'writing essay links',
        'validate-dist',
        withNote(
          `dist/writing/index.html has ${n} "starikov.co/" links, expected >= ${SITE.minCounts.essays}`,
          essaysNote,
        ),
      );
    }
  } else {
    fail(
      'writing essay links',
      'validate-dist',
      withNote('dist/writing/index.html does not exist', essaysNote),
    );
  }

  // ---- 3. curated theme CSS shipped (unconditional) ------------------------
  const astroDir = join(DIST, '_astro');
  const cssTexts = existsSync(astroDir)
    ? readdirSync(astroDir)
        .filter((f) => f.endsWith('.css'))
        .map((f) => readFileSync(join(astroDir, f), 'utf8'))
    : [];
  if (anyContains(cssTexts, '--code-comment')) {
    pass('theme CSS', 'the --code-comment sentinel is reachable in dist/_astro/*.css');
  } else {
    fail('theme CSS', 'validate-dist', 'no dist/_astro/*.css file contains the --code-comment sentinel');
  }

  // ---- 4. sitemap-index.xml exists (unconditional) -------------------------
  if (existsSync(join(DIST, 'sitemap-index.xml'))) {
    pass('sitemap', 'dist/sitemap-index.xml exists');
  } else {
    fail('sitemap', 'validate-dist', 'dist/sitemap-index.xml does not exist');
  }

  // ---- 5. pagefind/ exists, ONLY if the integration is wired up -----------
  const astroConfigSource = readFileSync(join(REPO_ROOT, 'astro.config.mjs'), 'utf8');
  if (pagefindEnabled(astroConfigSource)) {
    if (existsSync(join(DIST, 'pagefind'))) {
      pass('pagefind', 'dist/pagefind/ exists');
    } else {
      fail('pagefind', 'validate-dist', 'astro.config.mjs enables pagefind but dist/pagefind/ is missing');
    }
  } else {
    warnSkip('pagefind', 'validate-dist', 'pagefind integration not present yet (Task 16) -- skipping');
  }

  // ---- 6. CNAME in dist (unconditional) ------------------------------------
  const cnamePath = join(DIST, 'CNAME');
  if (existsSync(cnamePath) && cnameMatchesOrigin(readFileSync(cnamePath, 'utf8'), SITE.origin)) {
    pass('CNAME', `dist/CNAME matches ${new URL(SITE.origin).hostname}`);
  } else {
    fail('CNAME', 'validate-dist', `dist/CNAME is missing or does not match ${SITE.origin}`);
  }

  // ---- 7. academia volume URLs HEAD -> 200 (BUILD_STRICT only; network) ---
  if (strict) {
    const urls = PDF_VOLUMES.map((v) => `${ACADEMIA_PDF_ORIGIN}/${v.slug}.pdf`);
    const results = await checkUrls(urls, (url) => fetch(url, { method: 'HEAD' }));
    const bad = results.filter((r) => !r.ok);
    if (bad.length === 0) {
      pass('academia PDFs', `${urls.length}/${urls.length} volumes HEAD 200`);
    } else {
      fail(
        'academia PDFs',
        'academia',
        bad.map((r) => `${r.url} -> ${r.status ?? r.error}`).join('; '),
      );
    }
  } else {
    warnSkip('academia PDFs', 'validate-dist', 'BUILD_STRICT not set -- skipping network HEAD checks');
  }

  // ---- 8. counts vs SITE.minCounts (BUILD_STRICT only) ---------------------
  if (strict) {
    const actual = {
      essays: counts.essays?.count ?? 0,
      tools: counts.tools?.count ?? 0,
      themeVariants: themeVariantCount,
      projects: projectCount,
    };
    // Root-cause notes (Task 15 code-review fix): a loader's early-return/
    // catch path writes counts.<collection>.note alongside its explicit
    // zero (see report.ts's count()); fold whichever ones exist onto the
    // gate's failure entries so "0 < 1" reads as "0 < 1 (source checkout
    // not found at .sources/bin)" instead of leaving the reader to guess.
    const notes = {};
    for (const key of Object.keys(SITE.minCounts)) {
      if (counts[key]?.note) notes[key] = counts[key].note;
    }
    const failures = checkMinCounts(actual, SITE.minCounts, notes);
    if (failures.length === 0) {
      pass('min-counts', Object.entries(actual).map(([k, v]) => `${k}=${v}`).join(', '));
    } else {
      for (const f of failures) {
        fail('min-counts', f.key, withNote(`${f.actual} < ${f.min}`, f.note));
      }
    }
  } else {
    warnSkip('min-counts', 'validate-dist', 'BUILD_STRICT not set -- gate not enforced');
  }

  // ---- summary table ---------------------------------------------------------
  const table = formatSummaryTable(rows);
  console.log(`\nvalidate-dist summary:\n${table}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const fs = await import('node:fs');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### validate-dist\n\n${table}\n`);
  }

  if (hardFailure) {
    console.error('validate-dist: FAILED -- see ::error:: annotations above');
    process.exit(1);
  }
  console.log('validate-dist: OK');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
