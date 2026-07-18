/*
 * Client runtime for the theme picker (ThemeControl.astro).
 *
 * Two responsibilities:
 *   1. Define window.__setTheme(family, mode) -- the single mutation entry
 *      point. It writes localStorage, triggers the 120ms crossfade, re-applies
 *      via the boot script's window.__applyTheme, and fires a `themechange`
 *      CustomEvent. ⌘K (Task 17) calls this too.
 *   2. Wire the popover: open/close, aria state, Esc + focus return, outside
 *      click, arrow-key roving among family rows, and keeping the trigger +
 *      row swatches in sync with the live theme (including system-mode flips).
 *
 * The boot script (theme-boot.ts) owns the pre-paint attribute + theme-color;
 * this module never touches those directly -- it always goes through
 * window.__applyTheme so there is exactly one resolver.
 *
 * The home system card's `theme:` row is a SECOND trigger for this same single
 * `#theme-popover` -- it calls the exported `openThemePopover()` below instead of
 * cloning any picker state. open()/close() emit a `themepopover` CustomEvent so
 * that remote trigger can mirror aria-expanded without reaching into the popover.
 */

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

/* The primary control's open handle, registered when it is wired. The home
 * system card's theme row calls openThemePopover() to open this one shared
 * popover; there is exactly one ThemeControl (sidebar footer) in the document. */
let openPrimaryPopover: (() => void) | null = null;

/** Open the single shared theme popover from a remote trigger (the home system
 *  card's `theme:` row). No-op until the control is wired. */
export function openThemePopover(_anchor?: HTMLElement): void {
  openPrimaryPopover?.();
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

  const onOutsideClick = (e: MouseEvent) => {
    if (!root.contains(e.target as Node)) close(false);
  };

  function open(): void {
    if (isOpen()) return;
    popover.removeAttribute('hidden');
    trigger.setAttribute('aria-expanded', 'true');
    const active =
      familyButtons.find((b) => b.getAttribute('aria-pressed') === 'true') || familyButtons[0];
    active?.focus();
    // capture phase so the picker closes before other click handlers run
    document.addEventListener('click', onOutsideClick, true);
    dispatchPopoverState(true);
  }

  function close(returnFocus = true): void {
    if (!isOpen()) return;
    popover.setAttribute('hidden', '');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onOutsideClick, true);
    if (returnFocus) trigger.focus();
    dispatchPopoverState(false);
  }

  trigger.addEventListener('click', () => (isOpen() ? close() : open()));
  // Register this control as the target of remote openers (the system card row).
  openPrimaryPopover = open;

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
