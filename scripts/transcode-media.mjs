#!/usr/bin/env node
/*
 * transcode-media.mjs — prebuild step (runs BEFORE `astro build`, after
 * build-themes). Turns the academia showcase's animated GIFs into web video,
 * and its still images into AVIF+WebP, so the /academia page never ships a
 * multi-megabyte GIF or a verbatim multi-megabyte PNG (bolt_timer.png alone
 * was 2.9MB raw).
 *
 * For every `<img src="assets/NAME.ext">` referenced in PORTFOLIO.md:
 *   • GIF        → NAME.mp4  (H.264, yuv420p, faststart, even dimensions)
 *                + NAME.webm (VP9)
 *                + NAME.jpg  (first-frame poster)
 *   • other (PNG/JPG) → NAME.avif (q55, capped at 1440px wide)
 *                      + NAME.webp (q78 fallback, same cap)
 *
 * Work is digest-cached in public/media/academia/.digests.json keyed on the
 * source file's content hash: an unchanged source with its outputs already on
 * disk is skipped, so this runs once (per source change), not every nightly
 * build (design §6 / §7 "every heavy transform is digest-cached"). Missing
 * outputs (a stale/partial cache restore, or this script's own AVIF/WebP
 * addition landing after a source's digest was already cached) force a
 * re-run regardless of the digest match — outputsFor() self-heals: whatever
 * SHOULD exist for a given source is what's checked, so a half-populated
 * output set never silently stays half-populated.
 *
 * A dims manifest (public/media/academia/manifest.json) is rebuilt EVERY run
 * (cheap: metadata reads, not re-encodes) from whatever now sits in OUT_DIR,
 * keyed by slug — the same `basename(file, ext)` derivation
 * src/loaders/academia.ts's mediaRefFor() uses, so the loader and this script
 * agree on filenames by construction, never shared state. src/loaders/academia.ts
 * reads this manifest to attach intrinsic width/height to each MediaRef, which
 * the academia page renders as real <img>/<video> attributes — the CLS-zero
 * requirement (design §9) for showcase media.
 *
 * ffmpeg is required (installed locally and on the ubuntu runner) for GIFs;
 * sharp (an explicit devDependency, also an astro transitive) handles the
 * still-image encode. Missing ffmpeg is a hard `::error::` exit — a build that
 * silently shipped GIFs or raw PNGs would blow the media budget without
 * anyone noticing.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_REPO = join(REPO_ROOT, '.sources/academia');
const ASSETS_DIR = join(SOURCE_REPO, 'assets');
const PORTFOLIO = join(SOURCE_REPO, 'PORTFOLIO.md');
const OUT_DIR = join(REPO_ROOT, 'public/media/academia');
const DIGESTS = join(OUT_DIR, '.digests.json');
const MANIFEST = join(OUT_DIR, 'manifest.json');

// Still-image encode targets (brief: "AVIF q55, ≤1440w + WebP q78 fallback").
const IMAGE_MAX_WIDTH = 1440;
const AVIF_QUALITY = 55;
const WEBP_QUALITY = 78;

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

/**
 * PURE (paths only, no IO). The complete output set a given source SHOULD
 * produce — the self-heal check (main()) requires every one of these to
 * exist before a source is considered "already processed," so an old cache
 * that predates the AVIF/WebP switch (verbatim-copy outputs only) or a
 * partial restore is always topped up rather than left half-done.
 */
export function outputsFor(file) {
  const ext = extname(file).toLowerCase();
  const slug = basename(file, ext);
  if (ext === '.gif') {
    return [join(OUT_DIR, `${slug}.mp4`), join(OUT_DIR, `${slug}.webm`), join(OUT_DIR, `${slug}.jpg`)];
  }
  return [join(OUT_DIR, `${slug}.avif`), join(OUT_DIR, `${slug}.webp`)];
}

function transcodeGif(input, slug) {
  const mp4 = join(OUT_DIR, `${slug}.mp4`);
  const webm = join(OUT_DIR, `${slug}.webm`);
  const jpg = join(OUT_DIR, `${slug}.jpg`);
  run(['-i', input, '-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-vf', EVEN, '-an', '-c:v', 'libx264', '-crf', '23', mp4]); // prettier-ignore
  run(['-i', input, '-pix_fmt', 'yuv420p', '-vf', EVEN, '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', '-row-mt', '1', webm]); // prettier-ignore
  run(['-i', input, '-frames:v', '1', '-q:v', '3', jpg]);
}

/**
 * Still image → AVIF (q55) + WebP (q78), both capped at IMAGE_MAX_WIDTH wide
 * (never upscaled -- an image already narrower than the cap passes through at
 * its native width). Two independent sharp() pipelines (one per output) so
 * neither `.toFile()` call consumes a stream the other needs.
 */
async function transcodeImage(input, slug) {
  const avifPath = join(OUT_DIR, `${slug}.avif`);
  const webpPath = join(OUT_DIR, `${slug}.webp`);
  const meta = await sharp(input).metadata();
  const resize = meta.width && meta.width > IMAGE_MAX_WIDTH ? { width: IMAGE_MAX_WIDTH } : null;
  const pipeline = () => (resize ? sharp(input).resize(resize) : sharp(input));
  await pipeline().avif({ quality: AVIF_QUALITY }).toFile(avifPath);
  await pipeline().webp({ quality: WEBP_QUALITY }).toFile(webpPath);
}

/** Emitted AVIF's actual pixel dimensions (post-resize) via sharp's header read. */
async function imageDims(slug) {
  const meta = await sharp(join(OUT_DIR, `${slug}.avif`)).metadata();
  return { width: meta.width, height: meta.height };
}

/** Emitted mp4's actual pixel dimensions (post EVEN-scale filter) via ffprobe. */
function videoDims(slug) {
  const out = execFileSync(
    'ffprobe',
    [
      '-v', 'error', // prettier-ignore
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
      join(OUT_DIR, `${slug}.mp4`),
    ],
    { encoding: 'utf8' },
  );
  const stream = JSON.parse(out).streams?.[0];
  return { width: stream?.width, height: stream?.height };
}

async function main() {
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
  const manifest = {};

  for (const file of assets) {
    const input = join(ASSETS_DIR, file);
    if (!existsSync(input)) {
      warn(`referenced asset ${file} not found in ${ASSETS_DIR}; skipping`);
      continue;
    }

    const ext = extname(file).toLowerCase();
    const slug = basename(file, ext);
    const isVideo = ext === '.gif';
    const hash = sha256(input);
    const outputsExist = outputsFor(file).every(existsSync);

    if (needsTranscode(digests[file], hash, outputsExist)) {
      if (isVideo) {
        log(`transcoding ${file} → ${slug}.{mp4,webm,jpg}`);
        transcodeGif(input, slug);
      } else {
        log(`transcoding ${file} → ${slug}.{avif,webp}`);
        await transcodeImage(input, slug);
      }
      digests[file] = hash;
      processed += 1;
    } else {
      skipped += 1;
    }

    // Rebuilt every run (design §6) regardless of skip/process, straight from
    // whatever now sits on disk -- self-heals a manifest.json wiped or stale
    // relative to .digests.json without forcing a needless re-transcode.
    try {
      manifest[slug] = isVideo
        ? { kind: 'video', ...videoDims(slug), mp4: `${slug}.mp4`, webm: `${slug}.webm`, poster: `${slug}.jpg` }
        : { kind: 'image', ...(await imageDims(slug)), avif: `${slug}.avif`, webp: `${slug}.webp` };
    } catch (e) {
      warn(`could not read dimensions for ${slug}: ${e.message}`);
    }
  }

  writeFileSync(DIGESTS, JSON.stringify(digests, null, 2) + '\n');
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  log(
    `done — ${processed} processed, ${skipped} cached, ${assets.length} referenced, ` +
      `manifest: ${Object.keys(manifest).length} entries`,
  );
}

// Only run when invoked directly (so the pure helpers can be imported in tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    err(e.stack || e.message);
    process.exit(1);
  });
}
