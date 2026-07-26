#!/usr/bin/env node
/*
 * generate-pdf-thumbs.mjs — one-time, NOT part of the build chain.
 *
 * Renders the first page of a PDF into a committed JPEG thumbnail. Two call
 * sites share the same fetch-render-cleanup shell (renderFirstPage below):
 *
 *   - the four bound academia volumes -> src/assets/academia/<slug>.jpg
 *     (long-edge scaled -- these are the /academia Volumes shelf's covers,
 *     already comfortably square-ish; PDF_VOLUMES/ACADEMIA_PDF_ORIGIN come
 *     from site.config, so a volume rename/re-host doesn't need an edit here)
 *   - the résumé PDF -> src/assets/projects/resume.jpg (v1.1 polish Task 6,
 *     A14: /projects/resume's hero -- width-scaled instead of long-edge,
 *     since ProjectHero requests widths up to 1440 and a long-edge scale on
 *     a portrait US-letter page would cap the USABLE width well below that)
 *
 * The /academia page routes these through Astro <Image> for AVIF; committing
 * them means the build never needs to fetch PDFs or shell out to poppler.
 *
 * Run it again only when a source PDF's cover changes:
 *   node scripts/generate-pdf-thumbs.mjs
 *
 * Requires `pdftoppm` (poppler: `brew install poppler`) and network access to
 * academia.starikov.io / resume.starikov.io. Each PDF is downloaded to a temp
 * dir and deleted; only the committed JPEGs are kept.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDF_VOLUMES, ACADEMIA_PDF_ORIGIN } from '../src/site.config.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ACADEMIA_OUT_DIR = join(REPO_ROOT, 'src/assets/academia');
const PROJECTS_OUT_DIR = join(REPO_ROOT, 'src/assets/projects');
const ACADEMIA_SCALE = 800; // long-edge px; the page downsamples further for display.
const RESUME_URL = 'https://resume.starikov.io/illya-starikov-resume.pdf';
const RESUME_WIDTH = 1440; // matches ProjectHero's largest requested width.

function assertTool(bin, hint) {
  try {
    execFileSync(bin, ['-v'], { stdio: 'ignore' });
  } catch {
    console.error(`generate-pdf-thumbs: \`${bin}\` not found — ${hint}`);
    process.exit(1);
  }
}

/**
 * Fetches `url`, renders page 1 to `${outDir}/${slug}.jpg` via pdftoppm, and
 * removes the downloaded PDF. `scaleArgs` is pdftoppm's own sizing flags
 * (long-edge `-scale-to` for the academia covers, width-anchored
 * `-scale-to-x`/`-scale-to-y -1` for the résumé) so callers control the
 * output aspect handling without duplicating the fetch/render/cleanup shell.
 */
async function renderFirstPage(tmp, url, outDir, slug, scaleArgs) {
  const pdf = join(tmp, `${slug}.pdf`);
  console.log(`generate-pdf-thumbs: fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(pdf, buf);

  mkdirSync(outDir, { recursive: true });
  const outPrefix = join(outDir, slug); // -singlefile → <slug>.jpg exactly
  execFileSync('pdftoppm', ['-jpeg', '-singlefile', '-f', '1', '-l', '1', ...scaleArgs, pdf, outPrefix]);
  if (!existsSync(`${outPrefix}.jpg`)) throw new Error(`pdftoppm produced no ${slug}.jpg`);
  console.log(`generate-pdf-thumbs: wrote ${outDir === ACADEMIA_OUT_DIR ? 'src/assets/academia' : 'src/assets/projects'}/${slug}.jpg`);
}

async function main() {
  assertTool('pdftoppm', 'install poppler (`brew install poppler`)');
  const tmp = mkdtempSync(join(tmpdir(), 'pdf-thumbs-'));

  try {
    for (const { slug } of PDF_VOLUMES) {
      await renderFirstPage(
        tmp,
        `${ACADEMIA_PDF_ORIGIN}/${slug}.pdf`,
        ACADEMIA_OUT_DIR,
        slug,
        ['-scale-to', String(ACADEMIA_SCALE)],
      );
    }
    await renderFirstPage(tmp, RESUME_URL, PROJECTS_OUT_DIR, 'resume', [
      '-scale-to-x',
      String(RESUME_WIDTH),
      '-scale-to-y',
      '-1',
    ]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log('generate-pdf-thumbs: done. Commit the JPEGs.');
}

main().catch((err) => {
  console.error(`generate-pdf-thumbs: ${err.message}`);
  process.exit(1);
});
