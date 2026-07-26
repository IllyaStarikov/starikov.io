/*
 * App-shell client runtime (one module, loaded by Shell.astro).
 *
 * Responsibilities, all progressive enhancement over correct server output:
 *   1. Active nav: the sidebar persists across ClientRouter swaps, so its
 *      server-rendered active state goes stale. Re-resolve it from
 *      location.pathname (same longest-prefix rule as src/lib/nav.ts) on every
 *      page-load, and slide the 2px accent bar between positions via FLIP
 *      (transform-only, 180ms, disabled under reduced motion).
 *   2. TOC scrollspy (IntersectionObserver): active entry colour flips
 *      instantly; a 2px marker slides 180ms.
 *   3. Search affordance -> `open-palette` CustomEvent (Task 17 listens).
 *   4. Mobile nav <dialog>: open/close/backdrop/link-click (focus trap + Esc
 *      are native).
 *   5. Sheet vs resize: close the sheet if a resize/rotation crosses the
 *      1024px breakpoint while it's open, so it can't be stranded open behind
 *      the desktop sidebar with no control left that can reach it.
 *   6. Mobile mode toggle -> window.__setTheme (defined by theme-control.ts).
 *
 * Module state persists across ClientRouter navigations (no full reload), so
 * `barPrevY` carries the FLIP origin between pages.
 */

import { lockScroll, unlockScroll } from '../lib/scroll-lock';

export {};

declare global {
  interface Window {
    __setTheme?: (family: string, mode: 'light' | 'dark' | 'system') => void;
    __shellWired?: boolean;
  }
}

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const FLIP_MS = 180;

function reducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function normalizedPath(): string {
  const p = location.pathname;
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

/* --- 1. Active nav + FLIP bar --------------------------------------------- */

let barPrevY: number | null = null;

function updateActiveNav(): string | null {
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('[data-nav-link][data-href]'),
  );
  if (links.length === 0) return null;
  const path = normalizedPath();
  let best: string | null = null;
  for (const link of links) {
    const href = link.dataset.href;
    if (!href) continue;
    const match = href === '/' ? path === '/' : path === href || path.startsWith(href + '/');
    if (match && (best === null || href.length > best.length)) best = href;
  }
  links.forEach((link) => {
    const on = link.dataset.href === best;
    link.classList.toggle('is-active', on);
    if (on) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  return best;
}

function syncNav(animate: boolean): void {
  updateActiveNav();

  const host = document.querySelector<HTMLElement>('[data-flip-host]');
  const bar = host?.querySelector<HTMLElement>('[data-nav-bar]') ?? null;
  const active = host?.querySelector<HTMLElement>('.nav-link.is-active') ?? null;

  // Hidden host (mobile) or reduced motion -> fall back to the static per-item
  // bar (CSS ::before), which is always correct.
  if (!host || !bar || !active || host.offsetParent === null || reducedMotion()) {
    host?.removeAttribute('data-flip');
    barPrevY = null;
    return;
  }

  const y = active.offsetTop + 4;
  bar.style.height = `${Math.max(active.offsetHeight - 8, 2)}px`;

  if (animate && barPrevY !== null && barPrevY !== y) {
    bar.animate(
      [{ transform: `translateY(${barPrevY}px)` }, { transform: `translateY(${y}px)` }],
      { duration: FLIP_MS, easing: EASE },
    );
  }
  bar.style.transform = `translateY(${y}px)`;
  host.setAttribute('data-flip', 'on');
  barPrevY = y;
}

/* --- 2. TOC scrollspy ----------------------------------------------------- */

let tocObserver: IntersectionObserver | null = null;

function setupScrollspy(): void {
  tocObserver?.disconnect();
  tocObserver = null;

  const toc = document.querySelector<HTMLElement>('[data-toc]');
  if (!toc) return;
  const links = Array.from(toc.querySelectorAll<HTMLAnchorElement>('[data-toc-link]'));
  const marker = toc.querySelector<HTMLElement>('[data-toc-marker]');
  const headings = links
    .map((l) => document.getElementById(l.dataset.tocLink ?? ''))
    .filter((el): el is HTMLElement => el !== null);
  if (headings.length === 0) return;

  let activeId: string | null = null;
  const setActive = (id: string): void => {
    if (id === activeId) return;
    activeId = id;
    let activeLink: HTMLAnchorElement | null = null;
    links.forEach((link) => {
      const on = link.dataset.tocLink === id;
      link.classList.toggle('is-active', on);
      if (on) activeLink = link;
    });
    if (activeLink && marker) {
      const link = activeLink as HTMLElement;
      marker.style.height = `${link.offsetHeight}px`;
      marker.style.transform = `translateY(${link.offsetTop}px)`;
      toc.setAttribute('data-spy', 'on');
    }
  };

  tocObserver = new IntersectionObserver(
    (entries) => {
      // Prefer the entry nearest the top of the viewport that is on screen.
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    },
    // -69px matches --anchor-offset (tokens.css) exactly, not a separately
    // guessed number: a heading crosses into "active" right where the CSS
    // scroll-margin-top would have stopped an anchor jump from tucking it
    // under the topbar.
    { rootMargin: '-69px 0px -70% 0px', threshold: 0 },
  );
  headings.forEach((h) => tocObserver!.observe(h));
  setActive(headings[0].id);
}

/* --- 3. Search palette ---------------------------------------------------- */

function wireSearch(): void {
  document.querySelectorAll<HTMLElement>('[data-open-palette]').forEach((btn) => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      const sheet = document.querySelector<HTMLDialogElement>('[data-nav-sheet]');
      if (sheet?.open) sheet.close();
      document.dispatchEvent(new CustomEvent('open-palette'));
    });
  });
}

/* --- 4. Mobile nav dialog ------------------------------------------------- */

function wireDialog(): void {
  const sheet = document.querySelector<HTMLDialogElement>('[data-nav-sheet]');
  const openBtn = document.querySelector<HTMLButtonElement>('[data-nav-open]');
  if (!sheet) return;

  const close = (): void => {
    if (sheet.open) sheet.close();
  };

  if (openBtn && !openBtn.dataset.wired) {
    openBtn.dataset.wired = '1';
    openBtn.addEventListener('click', () => {
      sheet.showModal();
      // showModal() makes the background inert but does NOT stop it scrolling;
      // lock it (shared, ref-counted with the palette) until the sheet closes.
      lockScroll();
      openBtn.setAttribute('aria-expanded', 'true');
    });
  }

  if (!sheet.dataset.wired) {
    sheet.dataset.wired = '1';
    sheet.querySelector<HTMLButtonElement>('[data-nav-close]')?.addEventListener('click', close);
    // Backdrop click: the click target is the <dialog> itself.
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet) close();
    });
    // Navigating from a nav link should dismiss the sheet immediately.
    sheet.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
      a.addEventListener('click', close);
    });
    // Native Esc/close (and every close() path above) fires exactly one `close`
    // event -> release the scroll lock and keep the trigger's aria-expanded honest.
    sheet.addEventListener('close', () => {
      unlockScroll();
      openBtn?.setAttribute('aria-expanded', 'false');
    });
  }
}

/* --- 5. Sheet vs resize ----------------------------------------------------
 * The sheet (and the hamburger that opens it) only exist below 1024px
 * (Shell.astro's breakpoint). If a visitor rotates a tablet, or resizes a
 * desktop window across that line, with the sheet open, the desktop sidebar
 * appears underneath a still-open modal <dialog> that no on-screen control can
 * reach anymore. sheet.close() fires the native `close` event -> wireDialog's
 * listener already releases the scroll lock and resets the trigger's
 * aria-expanded, so there is nothing else to clean up here. */
function wireSheetAutoClose(): void {
  let desktop: MediaQueryList;
  try {
    desktop = matchMedia('(min-width: 1024px)');
  } catch {
    return; // matchMedia unsupported: the sheet just won't auto-close on resize
  }
  const onChange = (e: MediaQueryList | MediaQueryListEvent): void => {
    if (!e.matches) return;
    const sheet = document.querySelector<HTMLDialogElement>('[data-nav-sheet]');
    if (sheet?.open) sheet.close();
  };
  try {
    desktop.addEventListener('change', onChange);
  } catch {
    /* old Safari without MediaQueryList#addEventListener: same graceful no-op */
  }
}

/* --- 6. Mobile mode toggle -------------------------------------------------- */

function readMode(): 'light' | 'dark' | 'system' {
  try {
    const m = localStorage.getItem('theme:mode');
    return m === 'light' || m === 'dark' || m === 'system' ? m : 'system';
  } catch {
    return 'system';
  }
}

function readFamily(): string {
  try {
    return localStorage.getItem('theme:family') || 'tokyonight';
  } catch {
    return 'tokyonight';
  }
}

function effectiveDark(mode: 'light' | 'dark' | 'system'): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

function wireModeToggle(): void {
  document.querySelectorAll<HTMLElement>('[data-mode-toggle]').forEach((btn) => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      const next = effectiveDark(readMode()) ? 'light' : 'dark';
      window.__setTheme?.(readFamily(), next);
    });
  });
}

/* --- boot ----------------------------------------------------------------- */

function boot(animate: boolean): void {
  syncNav(animate);
  setupScrollspy();
  wireSearch();
  wireDialog();
  wireModeToggle();
}

// First paint: position the bar without animating.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => boot(false), { once: true });
} else {
  boot(false);
}

// Registered exactly once: the handler re-queries [data-nav-sheet] live on
// every fire, so it stays correct across every ClientRouter swap without
// needing to be re-wired (and without stacking a duplicate listener) on
// astro:page-load the way the per-element wire* functions above do.
wireSheetAutoClose();

// Every ClientRouter swap: re-resolve active item and slide the bar.
document.addEventListener('astro:page-load', () => boot(true));
