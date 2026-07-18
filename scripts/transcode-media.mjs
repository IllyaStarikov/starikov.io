#!/usr/bin/env node
/*
 * transcode-media.mjs — prebuild step (runs BEFORE `astro build`, after
 * build-themes). Turns the academia showcase's animated GIFs into web video and
 * copies its still images into public/media/academia/, so the /academia page
 * ships muted looping <video> instead of multi-megabyte GIFs.
 *
 * For every `<img src="assets/NAME.ext">` referenced in PORTFOLIO.md:
 *   • GIF  → NAME.mp4 (H.264, yuv420p, faststart, even dimensions)
 *          + NAME.webm (VP9)
 *          + NAME.jpg  (first-frame poster)
 *   • other (PNG) → copied verbatim to NAME.ext
 *
 * Work is digest-cached in public/media/academia/.digests.json keyed on the
 * source file's content hash: an unchanged source with its outputs already on
 * disk is skipped, so this runs once (per source change), not every nightly
 * build (design §6 / §7 "every heavy transform is digest-cached").
 *
 * ffmpeg is required (installed locally and on the ubuntu runner). Missing
 * ffmpeg is a hard `::error::` exit — a build that silently shipped GIFs would
 * blow the media budget without anyone noticing.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_REPO = join(REPO_ROOT, '.sources/academia');
const ASSETS_DIR = join(SOURCE_REPO, 'assets');
const PORTFOLIO = join(SOURCE_REPO, 'PORTFOLIO.md');
const OUT_DIR = join(REPO_ROOT, 'public/media/academia');
const DIGESTS = join(OUT_DIR, '.digests.json');

const ci = Boolean(process.env.GITHUB_ACTIONS);
const err = (msg) => console.log(ci ? `::error::${msg}` : `transcode-media: ERROR ${msg}`);
const warn = (msg) => console.log(ci ? `::warning::${msg}` : `transcode-media: WARN ${msg}`);
const log = (msg) => console.log(`transcode-media: ${msg}`);

/**
 * PURE. The skip decision: a source needs (re)processing when its content hash
 * changed OR any expected output is missing. Unit-tested; keep it side-effect
 * free.
 */
export function needsTranscode(cachedHash, currentHash, outputsExist) {
  return currentHash !== cachedHash || !outputsExist;
}

/** Unique `assets/*` image basenames referenced by PORTFOLIO.md, in order. */
function referencedAssets(md) {
  const seen = new Set();
  const out = [];
  for (const tag of md.match(/<img\b[^>]*>/gi) ?? []) {
    const src = tag.match(/\bsrc\s*=\s*"([^"]*)"/i)?.[1];
    if (!src || !/(^|\/)assets\//.test(src)) continue;
    const file = basename(src);
    if (!seen.has(file)) {
      seen.add(file);
      out.push(file);
    }
  }
  return out;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function run(args) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

const EVEN = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';

function outputsFor(file) {
  const ext = extname(file).toLowerCase();
  const slug = basename(file, ext);
  if (ext === '.gif') {
    return [join(OUT_DIR, `${slug}.mp4`), join(OUT_DIR, `${slug}.webm`), join(OUT_DIR, `${slug}.jpg`)];
  }
  return [join(OUT_DIR, file)];
}

function transcodeGif(input, slug) {
  const mp4 = join(OUT_DIR, `${slug}.mp4`);
  const webm = join(OUT_DIR, `${slug}.webm`);
  const jpg = join(OUT_DIR, `${slug}.jpg`);
  run(['-i', input, '-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-vf', EVEN, '-an', '-c:v', 'libx264', '-crf', '23', mp4]); // prettier-ignore
  run(['-i', input, '-pix_fmt', 'yuv420p', '-vf', EVEN, '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', '-row-mt', '1', webm]); // prettier-ignore
  run(['-i', input, '-frames:v', '1', '-q:v', '3', jpg]);
}

function main() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    err('ffmpeg not found on PATH — cannot transcode academia media');
    process.exit(1);
  }

  if (!existsSync(PORTFOLIO)) {
    warn(`${PORTFOLIO} missing (academia checkout absent?); nothing to transcode`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const digests = existsSync(DIGESTS) ? JSON.parse(readFileSync(DIGESTS, 'utf8')) : {};
  const assets = referencedAssets(readFileSync(PORTFOLIO, 'utf8'));

  let processed = 0;
  let skipped = 0;
  for (const file of assets) {
    const input = join(ASSETS_DIR, file);
    if (!existsSync(input)) {
      warn(`referenced asset ${file} not found in ${ASSETS_DIR}; skipping`);
      continue;
    }
    const hash = sha256(input);
    const outputsExist = outputsFor(file).every(existsSync);
    if (!needsTranscode(digests[file], hash, outputsExist)) {
      skipped += 1;
      continue;
    }

    const ext = extname(file).toLowerCase();
    const slug = basename(file, ext);
    if (ext === '.gif') {
      log(`transcoding ${file} → ${slug}.{mp4,webm,jpg}`);
      transcodeGif(input, slug);
    } else {
      log(`copying ${file}`);
      copyFileSync(input, join(OUT_DIR, file));
    }
    digests[file] = hash;
    processed += 1;
  }

  writeFileSync(DIGESTS, JSON.stringify(digests, null, 2) + '\n');
  log(`done — ${processed} processed, ${skipped} cached, ${assets.length} referenced`);
}

// Only run when invoked directly (so the pure helper can be imported in tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
