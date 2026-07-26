/*
 * Client runtime for the theme picker (ThemeControl.astro).
 *
 * Two responsibilities:
 *   1. Define window.__setTheme(family, mode) -- the single mutation entry
 *      point. It writes localStorage, triggers the 120ms crossfade, re-applies
 *      via the boot script's window.__applyTheme, and fires a `themechange`
 *      CustomEvent. ⌘K (Task 17) calls this too.
 *   2. Wire the popover: open/close, aria state, Esc + focus return, outside
 *      click + tab-out, arrow-key roving among family rows, JS-anchored
 *      `position: fixed` placement (src/lib/popover-position.ts owns the
 *      math -- see that file for why fixed positioning is needed at all),
 *      and keeping the trigger + row swatches in sync with the live theme
 *      (including system-mode flips).
 *
 * The boot script (theme-boot.ts) owns the pre-paint attribute + theme-color;
 * this module never touches those directly -- it always goes through
 * window.__applyTheme so there is exactly one resolver.
 *
 * The home system card's `theme:` row is a SECOND trigger for this same single
 * `#theme-popover` -- it calls the exported `openThemePopover(anchor)` below
 * instead of cloning any picker state; that anchor is what the popover
 * positions itself against and returns focus to on close. open()/close() emit
 * a `themepopover` CustomEvent so that remote trigger can mirror
 * aria-expanded without reaching into the popover.
 */

import { computePopoverPosition } from '../lib/popover-position';

type ThemeMode = 'light' | 'dark' | 'system';

declare global {
  interface Window {
    __applyTheme?: () => void;
    __setTheme?: (family: string, mode: ThemeMode) => void;
    __themeControlGlobalsWired?: boolean;
  }
}

const FAMILY_KEY = 'theme:family';
const MODE_KEY = 'theme:mode';
const DEFAULT_FAMILY_FALLBACK = 'tokyonight';

/* The primary control's open/close handles, registered when it is wired. The
 * home system card's theme row calls openThemePopover() to open this one
 * shared popover; there is exactly one ThemeControl (sidebar footer) in the
 * document. closePrimaryPopover backs the astro:before-swap listener below --
 * a page navigation must not leave the popover open (and its listeners live)
 * across the swap. */
let openPrimaryPopover: ((anchor?: HTMLElement) => void) | null = null;
let closePrimaryPopover: ((returnFocus?: boolean) => void) | null = null;

/** Open the single shared theme popover from a remote trigger (the home
 *  system card's `theme:` row), positioning it against that anchor and
 *  returning focus to it on close. No-op until the control is wired. */
export function openThemePopover(anchor?: HTMLElement): void {
  openPrimaryPopover?.(anchor);
}

function dispatchPopoverState(open: boolean): void {
  document.dispatchEvent(new CustomEvent('themepopover', { detail: { open } }));
}

function readFamily(defaultFamily: string): string {
  try {
    return localStorage.getItem(FAMILY_KEY) || defaultFamily;
  } catch {
    return defaultFamily;
  }
}

function readMode(): ThemeMode {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return m === 'light' || m === 'dark' || m === 'system' ? m : 'system';
  } catch {
    return 'system';
  }
}

function effectiveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* --- the global mutation API (defined once) -------------------------------- */
if (!window.__setTheme) {
  window.__setTheme = (family: string, mode: ThemeMode) => {
    try {
      localStorage.setItem(FAMILY_KEY, family);
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* private mode / storage disabled: still apply for this session */
    }
    const root = document.documentElement;
    const animate = !prefersReducedMotion();
    if (animate) root.classList.add('theme-transitioning');
    window.__applyTheme?.();
    if (animate) {
      setTimeout(() => root.classList.remove('theme-transitioning'), 200);
    }
    document.dispatchEvent(new CustomEvent('themechange'));
  };
}

/* --- per-control DOM sync -------------------------------------------------- */
interface Swatch {
  bg?: string;
  fg?: string;
  accent?: string;
}

function parseSwatch(json: string | undefined): Swatch {
  if (!json) return {};
  try {
    return JSON.parse(json) as Swatch;
  } catch {
    return {};
  }
}

function syncControl(root: HTMLElement): void {
  const defaultFamily = root.dataset.defaultFamily || DEFAULT_FAMILY_FALLBACK;
  const family = readFamily(defaultFamily);
  const mode = readMode();
  const eff = effectiveMode(mode);

  const dot = root.querySelector<HTMLElement>('[data-theme-dot]');
  const label = root.querySelector<HTMLElement>('[data-theme-label]');
  const familyButtons = root.querySelectorAll<HTMLButtonElement>('[data-family]');

  familyButtons.forEach((btn) => {
    const swatch = parseSwatch(btn.dataset[eff === 'dark' ? 'swatchDark' : 'swatchLight']);
    if (swatch.bg) {
      btn.style.background = swatch.bg;
      if (swatch.fg) btn.style.color = swatch.fg;
      const rowDot = btn.querySelector<HTMLElement>('[data-family-dot]');
      if (rowDot && swatch.accent) rowDot.style.background = swatch.accent;
    }
    const isActive = btn.dataset.family === family;
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    if (isActive) {
      if (label) {
        label.textContent = btn.querySelector('[data-family-name]')?.textContent?.trim() || family;
      }
      if (dot && swatch.accent) dot.style.background = swatch.accent;
    }
  });

  root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
    btn.setAttribute('aria-pressed', btn.dataset.mode === mode ? 'true' : 'false');
  });
}

function syncAllControls(): void {
  document.querySelectorAll<HTMLElement>('[data-theme-control]').forEach(syncControl);
}

/* --- per-control interaction wiring (guarded, idempotent) ------------------ */
function wireControl(root: HTMLElement): void {
  if (root.dataset.themeControlWired === 'true') return;
  root.dataset.themeControlWired = 'true';

  const defaultFamily = root.dataset.defaultFamily || DEFAULT_FAMILY_FALLBACK;
  const triggerEl = root.querySelector<HTMLButtonElement>('[data-theme-trigger]');
  const popoverEl = root.querySelector<HTMLElement>('[data-theme-popover]');
  if (!triggerEl || !popoverEl) return;
  // Re-bind to non-null consts so the nested open()/close() closures narrow.
  const trigger = triggerEl;
  const popover = popoverEl;

  const familyButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-family]'));

  const isOpen = () => !popover.hasAttribute('hidden');

  // The element the popover is currently anchored to AND will return focus to
  // on close -- the trigger for a normal click, or the SystemCard theme row
  // when opened remotely via openThemePopover(anchor). Defaults to the
  // trigger so close()'s `returnFocus` path is always safe pre-first-open.
  let currentAnchor: HTMLElement = trigger;

  const onOutsideClick = (e: MouseEvent) => {
    if (!root.contains(e.target as Node)) close(false);
  };

  // Reposition while open (window resize, or a scroll anywhere that might be
  // the sidebar's own overflow-y:auto -- see the capture-phase `scroll`
  // listener below). Not attached until open() runs, and removed in close(),
  // so this never fires against a hidden popover.
  const onReposition = (): void => {
    if (isOpen()) applyPosition();
  };

  // Non-modal close-on-tab-out: focus leaving the popover entirely (forward
  // past the last row, or back past the first to the trigger) closes it.
  // relatedTarget is null when the new focus target is unknown to the DOM
  // (e.g. focus left the document) -- that is NOT "focus moved outside the
  // popover to somewhere else on the page", so it is ignored rather than
  // treated as a close.
  const onFocusOut = (e: FocusEvent): void => {
    const related = e.relatedTarget as Node | null;
    if (related === null) return;
    if (!popover.contains(related)) close(false);
  };

  /* JS-anchored position:fixed (src/lib/popover-position.ts has the full
   * rationale): measure both boxes and write left/bottom as inline styles.
   * Pure DOM plumbing around computePopoverPosition -- the actual math is
   * tested directly, without any of this. */
  function applyPosition(): void {
    const anchorRect = currentAnchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const { left, bottom } = computePopoverPosition({
      anchor: { top: anchorRect.top, right: anchorRect.right },
      popover: { width: popoverRect.width, height: popoverRect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    popover.style.left = `${left}px`;
    popover.style.bottom = `${bottom}px`;
  }

  function open(anchor: HTMLElement = trigger): void {
    if (isOpen()) return;
    // Defense in depth: if this control lives in a hidden subtree (the sidebar is
    // display:none below 1024px), opening would unhide a popover no one can see
    // and dispatch a bogus "open" state. offsetParent === null on the trigger
    // means the whole control is not displayed -- do nothing at all.
    if (trigger.offsetParent === null) return;
    currentAnchor = anchor;
    // Measure via visibility:hidden: un-hide (so it has real layout to
    // measure) but stay invisible while applyPosition() computes and writes
    // the correct left/bottom, THEN reveal -- so a visitor never sees the
    // popover flash at its wrong, unpositioned spot first.
    popover.style.visibility = 'hidden';
    popover.removeAttribute('hidden');
    applyPosition();
    popover.style.visibility = '';
    trigger.setAttribute('aria-expanded', 'true');
    const active =
      familyButtons.find((b) => b.getAttribute('aria-pressed') === 'true') || familyButtons[0];
    active?.focus();
    // capture phase so the picker closes before other click handlers run
    document.addEventListener('click', onOutsideClick, true);
    window.addEventListener('resize', onReposition);
    // capture phase: `scroll` doesn't bubble, and the sidebar (the scroll
    // container that clips this popover if it isn't repositioned) is a
    // descendant, not document/window itself.
    document.addEventListener('scroll', onReposition, true);
    popover.addEventListener('focusout', onFocusOut);
    dispatchPopoverState(true);
  }

  function close(returnFocus = true): void {
    if (!isOpen()) return;
    popover.setAttribute('hidden', '');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onOutsideClick, true);
    window.removeEventListener('resize', onReposition);
    document.removeEventListener('scroll', onReposition, true);
    popover.removeEventListener('focusout', onFocusOut);
    // Not the trigger unconditionally -- the actual opener, which may be the
    // SystemCard row (see currentAnchor above).
    if (returnFocus) currentAnchor.focus();
    dispatchPopoverState(false);
  }

  trigger.addEventListener('click', () => (isOpen() ? close() : open(trigger)));
  // Register this control as the target of remote openers (the system card row)
  // and of the module-wide astro:before-swap close (below).
  openPrimaryPopover = open;
  closePrimaryPopover = close;

  popover.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    const idx = familyButtons.indexOf(document.activeElement as HTMLButtonElement);
    if (idx === -1) return;
    let next = -1;
    if (e.key === 'ArrowDown') next = (idx + 1) % familyButtons.length;
    else if (e.key === 'ArrowUp') next = (idx - 1 + familyButtons.length) % familyButtons.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = familyButtons.length - 1;
    if (next !== -1) {
      e.preventDefault();
      familyButtons[next].focus();
    }
  });

  familyButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      window.__setTheme?.(btn.dataset.family as string, readMode());
      // keep the popover open so a visitor can compare families live
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.__setTheme?.(readFamily(defaultFamily), btn.dataset.mode as ThemeMode);
    });
  });

  syncControl(root);
}

/* --- global listeners (wired once for the whole session) ------------------- */
function wireGlobals(): void {
  if (window.__themeControlGlobalsWired) return;
  window.__themeControlGlobalsWired = true;
  document.addEventListener('themechange', syncAllControls);
  // A ClientRouter navigation must not leave the popover open (and its
  // resize/scroll/focusout listeners live) across the swap; the anchor that
  // opened it may not even survive (the SystemCard row is swapped content).
  // No focus return -- the swap is about to move focus itself.
  document.addEventListener('astro:before-swap', () => closePrimaryPopover?.(false));
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (readMode() === 'system') syncAllControls();
    });
  } catch {
    /* matchMedia unsupported: system-mode UI just won't live-update */
  }
}

function boot(): void {
  wireGlobals();
  document.querySelectorAll<HTMLElement>('[data-theme-control]').forEach(wireControl);
}

boot();
// ClientRouter swaps in fresh DOM without re-executing this module -> re-wire.
document.addEventListener('astro:page-load', boot);
