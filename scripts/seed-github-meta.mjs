#!/usr/bin/env node
// Seeds/refreshes the committed vendor snapshot at src/data/vendor/github-meta.json
// from the real GitHub API, for every repo in SITE.projectRepos (src/site.config.mjs).
// This file is the `repos` collection's (Task 11, src/loaders/github-meta.ts) last
// line of defense: when the live API is unreachable and there's no per-run
// `.cache/github-meta/` entry either (a fresh clone, an outage, a rate limit), the
// loader falls back to whatever was last committed here.
//
// Usage:
//   node scripts/seed-github-meta.mjs
//
// Public repos at this volume (9 repos) don't need a token, but GITHUB_TOKEN is
// honored when set (higher rate limit -- 60/hr unauthenticated vs 5000/hr with a
// token). A 403 (rate limit) on one repo is a warning, not a hard failure: the
// script writes whatever it DID fetch, merged over the existing snapshot, so a
// partial run never wipes out previously seeded entries.
//
// NOTE on the small duplication below: `mapRepoResponse` here is a deliberate,
// intentionally tiny (7-field) re-implementation of src/loaders/github-meta.ts's
// `mapRepoResponse`. That module is TypeScript with extension-less relative
// imports (the Astro/bundler convention); importing it from plain `node` would
// need either a build step or Node's `--experimental-strip-types` PLUS explicit
// `.ts` extensions Node's loader requires but TS's `bundler` resolution doesn't
// -- not worth the fragility for a one-off/refresh script. The shape is a small,
// stable, test-covered contract (`test/github-meta-loader.test.ts` covers the
// TS side against the same documented API fields); keep the two in sync by hand
// if GitHub's response shape or GithubRepoMeta ever changes.

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '../src/site.config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const VENDOR_PATH = join(REPO_ROOT, 'src/data/vendor/github-meta.json');
const GITHUB_API = 'https://api.github.com/repos/';

function warn(msg) {
  console.warn(`seed-github-meta: ${msg}`);
}

/** Mirrors src/loaders/github-meta.ts's mapRepoResponse -- see the NOTE above. */
function mapRepoResponse(json) {
  if (!json || typeof json !== 'object' || typeof json.full_name !== 'string') {
    throw new Error(`unexpected response shape: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return {
    fullName: json.full_name,
    description: json.description ?? null,
    stars: json.stargazers_count ?? 0,
    pushedAt: json.pushed_at,
    language: json.language ?? null,
    topics: Array.isArray(json.topics) ? json.topics : [],
    archived: Boolean(json.archived),
  };
}

async function fetchRepoMeta(full) {
  const res = await fetch(`${GITHUB_API}${full}`, {
    headers: {
      accept: 'application/vnd.github+json',
      ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API responded ${res.status} ${res.statusText} for ${full}`);
  }
  return mapRepoResponse(await res.json());
}

async function main() {
  const existing = existsSync(VENDOR_PATH)
    ? JSON.parse(readFileSync(VENDOR_PATH, 'utf8'))
    : {};
  const snapshot = { ...existing };

  let ok = 0;
  let failed = 0;

  for (const full of SITE.projectRepos) {
    try {
      const meta = await fetchRepoMeta(full);
      snapshot[full.toLowerCase()] = meta;
      console.log(`  ${full}: ${meta.stars} stars, pushed ${meta.pushedAt}`);
      ok += 1;
    } catch (err) {
      warn(`${full}: ${err.message} (keeping any previously seeded entry)`);
      failed += 1;
    }
  }

  // Sort keys for a stable, reviewable diff on refresh.
  const sorted = Object.fromEntries(Object.keys(snapshot).sort().map((k) => [k, snapshot[k]]));

  mkdirSync(dirname(VENDOR_PATH), { recursive: true });
  writeFileSync(VENDOR_PATH, `${JSON.stringify(sorted, null, 2)}\n`);

  console.log(
    `seed-github-meta: wrote ${Object.keys(sorted).length} repo(s) to ${VENDOR_PATH} (${ok} fetched this run, ${failed} failed)`,
  );
  if (failed > 0 && ok === 0) {
    process.exitCode = 1;
  }
}

await main();
