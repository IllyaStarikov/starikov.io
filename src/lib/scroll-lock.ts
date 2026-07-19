/*
 * scroll-lock -- shared background scroll-lock for the site's two full-screen
 * overlays: the ⌘K command palette (src/scripts/palette.ts) and the mobile
 * navigation <dialog> (src/scripts/shell.ts).
 *
 * Both freeze the page behind them with `html { overflow: hidden }`. A native
 * <dialog>.showModal() makes the background inert but does NOT stop it
 * scrolling, so the sheet needs this too. Sharing one reference-counted lock
 * keeps the two from clobbering each other's restore: opening the palette from
 * inside the open nav sheet locks twice and unlocks twice, so `overflow` is only
 * cleared once BOTH have closed -- never prematurely, never left stuck.
 *
 * Vite hoists this module into a chunk shared by both importers, so the counter
 * is a single instance across the eagerly-bundled shell runtime and the
 * lazily-imported palette module.
 */

let locks = 0;

export function lockScroll(): void {
  if (locks === 0) document.documentElement.style.overflow = 'hidden';
  locks++;
}

export function unlockScroll(): void {
  if (locks === 0) return;
  locks--;
  if (locks === 0) document.documentElement.style.overflow = '';
}
