#!/usr/bin/env node
/*
 * generate-og-default.mjs -- renders public/og-default.png ONCE (1200x630), the
 * static default social card (design spec §7: "static default OG card in v1").
 * Committed to the repo; this script stays only so the card can be regenerated
 * if the palette or wordmark changes -- it is NOT part of `npm run build`.
 *
 * The card is composed programmatically from the tokyonight-storm palette (the
 * site's dark default), in the same neofetch/terminal idiom as the home system
 * card: the `~/starikov` wordmark behind a prompt caret, a one-line dek, and the
 * ANSI color strip that is the theme system's signature. sharp (already present
 * as a transitive dep of Astro) rasterizes an inline SVG.
 *
 * Usage: node scripts/generate-og-default.mjs
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'og-default.png');

const W = 1200;
const H = 630;

// tokyonight-storm (src/theme/tokyonight/storm/colors.json) -- the site default.
const C = {
  bg: '#24283b',
  surface: '#1f2335',
  border: '#3b4261',
  fg: '#c0caf5',
  secondary: '#8890b2',
  accent: '#7aa2f7',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
};

const ansi = [C.red, C.green, C.yellow, C.blue, C.magenta, C.cyan];
const MONO = "'SF Mono', 'SFMono-Regular', 'Menlo', 'DejaVu Sans Mono', 'Liberation Mono', monospace";

// Inset card geometry.
const pad = 64;
const cardX = pad;
const cardY = pad;
const cardW = W - pad * 2;
const cardH = H - pad * 2;
const stripH = 20;

const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="16"
        fill="${C.surface}" stroke="${C.border}" stroke-width="1.5"/>

  <!-- host line -->
  <text x="${cardX + 56}" y="${cardY + 92}" font-family="${MONO}" font-size="30" font-weight="700"
        fill="${C.secondary}"><tspan fill="${C.accent}">illya@</tspan>starikov.io</text>

  <!-- prompt + wordmark -->
  <text x="${cardX + 56}" y="${cardY + 232}" font-family="${MONO}" font-size="112" font-weight="700"
        fill="${C.fg}" letter-spacing="-2"><tspan fill="${C.accent}">~ &#10095; </tspan>~/starikov</text>

  <!-- dek -->
  <text x="${cardX + 60}" y="${cardY + 312}" font-family="${MONO}" font-size="34" fill="${C.secondary}">software engineer &#183; the workshop</text>

  <!-- neofetch fields -->
  <text x="${cardX + 60}" y="${cardY + 392}" font-family="${MONO}" font-size="26" fill="${C.secondary}">57 themes / 17 families<tspan fill="${C.border}">  &#183;  </tspan>generated from ~/.dotfiles</text>

  <!-- ANSI signature strip along the card foot -->
  ${ansi
    .map((color, i) => {
      const bw = (cardW - 112) / ansi.length;
      const x = cardX + 56 + i * bw;
      const y = cardY + cardH - 56 - stripH;
      const r = i === 0 ? 4 : 0;
      return `<rect x="${x}" y="${y}" width="${bw - 6}" height="${stripH}" rx="${r}" fill="${color}"/>`;
    })
    .join('\n  ')}
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(OUT);
console.log(`og-default: wrote ${OUT} (${W}x${H})`);
