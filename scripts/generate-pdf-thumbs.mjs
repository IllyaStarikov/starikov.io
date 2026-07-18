#!/usr/bin/env node
/*
 * generate-pdf-thumbs.mjs — one-time, NOT part of the build chain.
 *
 * Renders the first page of each of the four bound academia volumes into a
 * committed JPEG thumbnail at src/assets/academia/<slug>.jpg. The /academia
 * page routes these through Astro <Image> for AVIF; committing them means the
 * build never needs to fetch a 60MB set of PDFs or shell out to poppler.
 *
 * Run it again only when a volume's cover changes:
 *   node scripts/generate-pdf-thumbs.mjs
 *
 * Requires `pdftoppm` (poppler: `brew install poppler`) and network access to
 * academia.starikov.io. The PDFs are downloaded to a temp dir and deleted; only
 * the four JPEGs are kept (and committed).
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDF_VOLUMES, ACADEMIA_PDF_ORIGIN } from '../src/site.config.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(REPO_ROOT, 'src/assets/academia');
const SCALE = 800; // long-edge px; the page downsamples further for display.

function assertTool(bin, hint) {
  try {
    execFileSync(bin, ['-v'], { stdio: 'ignore' });
  } catch {
    console.error(`generate-pdf-thumbs: \`${bin}\` not found — ${hint}`);
    process.exit(1);
  }
}

async function main() {
  assertTool('pdftoppm', 'install poppler (`brew install poppler`)');
  mkdirSync(OUT_DIR, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), 'academia-pdf-'));

  try {
    for (const { slug } of PDF_VOLUMES) {
      const url = `${ACADEMIA_PDF_ORIGIN}/${slug}.pdf`;
      const pdf = join(tmp, `${slug}.pdf`);
      console.log(`generate-pdf-thumbs: fetching ${url}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await import('node:fs/promises').then((fs) => fs.writeFile(pdf, buf));

      const outPrefix = join(OUT_DIR, slug); // -singlefile → <slug>.jpg exactly
      execFileSync('pdftoppm', [
        '-jpeg',
        '-singlefile',
        '-f',
        '1',
        '-l',
        '1',
        '-scale-to',
        String(SCALE),
        pdf,
        outPrefix,
      ]);
      if (!existsSync(`${outPrefix}.jpg`)) throw new Error(`pdftoppm produced no ${slug}.jpg`);
      console.log(`generate-pdf-thumbs: wrote src/assets/academia/${slug}.jpg`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log('generate-pdf-thumbs: done. Commit the four JPEGs.');
}

main().catch((err) => {
  console.error(`generate-pdf-thumbs: ${err.message}`);
  process.exit(1);
});
