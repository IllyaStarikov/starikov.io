#!/usr/bin/env node
/*
 * generate-favicons.mjs -- renders public/favicon.ico and
 * public/apple-touch-icon.png ONCE (v1.1 polish Task 7), the two raster
 * fallbacks the SVG favicon can't cover on its own. Committed to the repo;
 * this script stays only so both can be regenerated if the glyph or palette
 * changes -- it is NOT part of `npm run build` (the glyph doesn't change
 * build to build, same reasoning as generate-og-default.mjs's PNG).
 *
 * Both icons reuse the SAME "❯" prompt-caret glyph as public/favicon.svg
 * (the terminal-prompt mark the home hero's "~ ❯ whoami" line and the
 * favicon already use), rendered as an inline SVG and rasterized by sharp
 * (already a devDependency for Astro's own image pipeline):
 *
 *   favicon.ico (32x32) -- a fallback for contexts that don't support SVG
 *     favicons. Rendered with the SAME default (light-mode) fill the SVG
 *     favicon uses before its embedded `prefers-color-scheme: dark` rule
 *     overrides it (#1a1b26, transparent background) -- a static .ico has no
 *     media-query capability, so this picks the one style that's correct
 *     when nothing else is known about the surrounding chrome.
 *   apple-touch-icon.png (180x180) -- iOS/Safari's home-screen and
 *     pinned-tab icon. iOS composites a transparent PNG onto an
 *     unpredictable (often black) backdrop, so this one gets a real
 *     background PLATE instead: tokyonight-storm's bg (#24283b, the site's
 *     dark default -- the same hex Base.astro's static no-JS theme-color
 *     fallback uses) behind the light glyph fill (#c0caf5, the SVG
 *     favicon's own dark-mode fill). No pre-rounded corners -- iOS applies
 *     its own mask to a full-bleed square.
 *
 * sharp has no native .ico encoder (it's a raster PNG/JPEG/etc. library, and
 * ICO is a container format), so favicon.ico is hand-assembled: a minimal
 * single-image ICONDIR + ICONDIRENTRY wrapped around a plain PNG buffer.
 * This "PNG-compressed ICO" form has been valid since Windows Vista and is
 * what every modern browser (and most favicon generators) actually produce
 * for 32x32 -- there is no raw-bitmap encoding involved.
 *
 * Usage: node scripts/generate-favicons.mjs
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

// The favicon.svg glyph, verbatim: a "❯" (U+276F) in the system mono stack,
// centered in a 100x100 viewBox. `size` sets the rendered raster's intrinsic
// px (rendered larger than the final output and downsampled by sharp's
// resize for a cleaner anti-alias than rasterizing directly at a tiny size).
function glyphSvg({ size, fill, plate }) {
  const bg = plate ? `<rect width="100" height="100" fill="${plate}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">${bg}<text x="50" y="72" font-family="ui-monospace,Menlo,monospace" font-size="72" font-weight="700" text-anchor="middle" fill="${fill}">&#10095;</text></svg>`;
}

/** Wrap a single PNG buffer in a minimal ICO container (ICONDIR + one
 *  ICONDIRENTRY + the raw PNG bytes) -- the "PNG-compressed" ICO format
 *  every modern browser reads. `size` must be <256 (the format's 1-byte
 *  width/height field; 0 there means "256"). */
function pngToIco(pngBuffer, size) {
  const iconDir = Buffer.alloc(6);
  iconDir.writeUInt16LE(0, 0); // reserved, must be 0
  iconDir.writeUInt16LE(1, 2); // type: 1 = icon
  iconDir.writeUInt16LE(1, 4); // image count

  const entry = Buffer.alloc(16);
  entry.writeUInt8(size, 0); // width
  entry.writeUInt8(size, 1); // height
  entry.writeUInt8(0, 2); // color count (0 = no palette, i.e. >=8bpp)
  entry.writeUInt8(0, 3); // reserved, must be 0
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8); // size of the image data
  entry.writeUInt32LE(6 + 16, 12); // offset of the image data

  return Buffer.concat([iconDir, entry, pngBuffer]);
}

// -- favicon.ico: 32x32, transparent bg, the SVG's default (light-mode) fill.
const faviconPng = await sharp(Buffer.from(glyphSvg({ size: 256, fill: '#1a1b26' })))
  .resize(32, 32)
  .png()
  .toBuffer();
const icoPath = join(PUBLIC_DIR, 'favicon.ico');
await writeFile(icoPath, pngToIco(faviconPng, 32));
console.log(`favicon.ico: wrote ${icoPath} (32x32, PNG-compressed ICO)`);

// -- apple-touch-icon.png: 180x180, tokyonight-storm plate + light glyph.
const touchIconPath = join(PUBLIC_DIR, 'apple-touch-icon.png');
await sharp(Buffer.from(glyphSvg({ size: 180, fill: '#c0caf5', plate: '#24283b' })))
  .png()
  .toFile(touchIconPath);
console.log(`apple-touch-icon.png: wrote ${touchIconPath} (180x180)`);
