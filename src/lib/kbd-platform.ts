/*
 * kbd-platform.ts -- pure logic for the Kbd component's per-platform swap.
 *
 * Kbd.astro always server-renders the Mac glyph (⌘) plus an sr-only "Command
 * …" label -- a fixed SSR default, not a guess made per-visitor (the server
 * doesn't know the client's platform). At first client paint, shell.ts (the
 * earliest client script that actually runs AFTER the body it needs to touch
 * exists -- see that file's comment on why the <head> theme-boot script is
 * too early for this) swaps the visible glyph to "Ctrl" and the label's
 * leading "Command" to "Control" for a visitor not on an Apple platform, so
 * the hint stays honest instead of showing a key that isn't on their
 * keyboard (see isNonMacPlatform below for why "Apple" means more than just
 * "Mac" here).
 *
 * Split into its own Astro-free module (rather than living inline in
 * shell.ts) so both halves -- the platform read and the DOM mutation -- are
 * unit-testable directly: the platform check with plain objects, the DOM
 * mutation with linkedom (same "testable pure core, DOM-touching wiring
 * stays in scripts/" split as popover-position.ts/theme-control.ts).
 */

/**
 * True when the platform is NOT an Apple one -- the one case Kbd.astro's SSR
 * default (⌘) is wrong for. "Apple" here is macOS *and* iOS/iPadOS: both use
 * the ⌘ convention for keyboard shortcuts (including with an external/
 * Bluetooth keyboard on an iPad or iPhone), so `platform` values like
 * "iPhone" and "iPad" must NOT be treated as "show Ctrl" just because they
 * don't literally contain "mac" -- only Windows/Linux/ChromeOS/Android and
 * the like should flip.
 *
 * Prefers the modern userAgentData Client Hint (Chromium only -- Safari
 * doesn't implement it, on macOS or iOS); falls back to the long-deprecated
 * but still-live `navigator.platform` everywhere else (also the only signal
 * on Safari: "MacIntel" for both real Macs and, since iPadOS 13's desktop-
 * site spoofing, iPads too). No platform signal at all (both absent, e.g. a
 * locked-down browser) reads as "mac" -- the SSR default already matches, so
 * silence is the safe direction; never flip to Ctrl on a guess.
 */
export function isNonMacPlatform(nav: {
  userAgentData?: { platform?: string };
  platform?: string;
}): boolean {
  const platform = nav.userAgentData?.platform || nav.platform || '';
  if (!platform) return false;
  return !/mac|iphone|ipad|ipod/i.test(platform);
}

/**
 * Flip every `[data-kbd-glyph]` element's visible "⌘" to "Ctrl" and every
 * `[data-kbd-label]` element's leading "Command" word to "Control", within
 * `root`. Idempotent -- re-running against an already-swapped (or never-⌘)
 * document changes nothing -- so it's safe to call on every astro:page-load,
 * not just the first: most navigations re-render fresh SSR markup (back at
 * the ⌘ default) that needs the swap again, but the one persisted element
 * (the desktop sidebar's search hint, `transition:persist`) is already
 * swapped and simply matches nothing on repeat calls.
 *
 * "⌘" is replaced with "Ctrl " (trailing space) when it's glued to a
 * following non-space character -- Kbd.astro's real glyph content is "⌘K"
 * (Sidebar.astro/404.astro/index.astro), and a bare `/⌘/g -> 'Ctrl'` swap
 * produced the unreadable "CtrlK" with no separator. A standalone "⌘" (the
 * Palette footer's "new tab" hint, its own `<kbd>` with nothing else in its
 * textContent) still becomes plain "Ctrl", no trailing space.
 */
export function swapKbdToNonMac(root: ParentNode): void {
  root.querySelectorAll('[data-kbd-glyph]').forEach((el) => {
    if (el.textContent && el.textContent.includes('⌘')) {
      el.textContent = el.textContent.replace(/⌘(\S)/g, 'Ctrl $1').replace(/⌘/g, 'Ctrl');
    }
  });
  root.querySelectorAll('[data-kbd-label]').forEach((el) => {
    if (el.textContent && /^Command\b/.test(el.textContent)) {
      el.textContent = el.textContent.replace(/^Command\b/, 'Control');
    }
  });
}
