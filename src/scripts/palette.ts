/*
 * palette.ts -- the <command-palette> custom element (design §8).
 *
 * Loaded lazily: a tiny always-on bootstrap (in Palette.astro) imports this
 * module on browser idle or the first ⌘K / "/" / open-palette trigger, which
 * registers the element; the shell markup already in the DOM then upgrades.
 * The index (~15KB) is fetched once and cached at MODULE scope, so a fresh
 * <command-palette> swapped in by ClientRouter on every navigation reuses it
 * without re-fetching (the house "hard state lives in module scope" pattern).
 *
 * ARIA combobox (APG 1.2): the text input keeps DOM focus the whole time and
 * owns aria-activedescendant; the results are a role="listbox" of role="option"
 * rows grouped by role="group"/aria-labelledby; a polite live region announces
 * the result count. Tab is trapped (the input is the only tab stop). ⌘K toggles,
 * "/" opens (unless typing), Esc closes and returns focus to the invoker,
 * ↑/↓ move the active option, Enter activates, ⌘/Ctrl+Enter opens links in a new
 * tab. Filtering re-renders the list instantly with no animation; only the panel
 * open/close is animated (reduced motion disables even that).
 *
 * Groups, in order: Jump to -> Essays (↗, external) -> Theme -> Actions ->
 * Content (Pagefind full-text, only for 3+ char queries; the import fails
 * silently in `astro dev`, which ships no /pagefind bundle -- the group is just
 * omitted there).
 */
import { rankItem } from '../lib/fuzzy';

interface SiteItem {
  type: 'tool' | 'project' | 'essay' | 'page';
  slug: string;
  title: string;
  tagline: string;
  href: string;
  date?: string;
}
interface ThemeEntry {
  family: string;
  name: string;
  dark: string;
  light: string;
}
interface PaletteIndex {
  items: SiteItem[];
  themes: ThemeEntry[];
  version: string;
}

type Mode = 'light' | 'dark' | 'system';

interface Cmd {
  id: string;
  group: number;
  title: string;
  sub: string;
  hint: string;
  accent?: string; // theme swatch dot
  external?: boolean;
  keepOpen?: boolean; // theme commands: stay open to compare
  search: string;
  searchSub: string;
  run: (newTab: boolean) => void;
}

const GROUPS = ['Jump to', 'Essays', 'Theme', 'Actions', 'Content'];
const PF_MIN = 3; // chars before Pagefind kicks in
const PF_LIMIT = 5; // Content rows
const ESSAYS_EMPTY = 6; // essays shown with no query
const ESSAYS_QUERY = 8; // essays shown while filtering
const JUMP_QUERY = 8;

/** github repo the "Open repo for current page" action resolves to, by path.
 *  Best-effort: unknown paths fall back to the site's own repo. */
const REPO_MAP: [string, string][] = [
  ['/bin', 'bin'],
  ['/projects/dotfiles', '.dotfiles'],
  ['/projects/eclecta', 'eclecta'],
  ['/projects/mcp-servers', 'omnifocus-mcp'],
  ['/projects/artificial', 'artificial'],
  ['/projects/resume', 'resume'],
  ['/projects/profile', 'IllyaStarikov'],
  ['/academia', 'academia'],
];
function repoForPath(path: string): string {
  for (const [prefix, repo] of REPO_MAP) {
    if (path === prefix || path.startsWith(prefix + '/')) {
      return `https://github.com/IllyaStarikov/${repo}`;
    }
  }
  return 'https://github.com/IllyaStarikov/starikov.io';
}

// --- module-scope index cache (survives ClientRouter swaps) -----------------
let INDEX: PaletteIndex | null = null;
let INDEX_PROMISE: Promise<void> | null = null;

function loadIndex(onReady: () => void): void {
  if (INDEX) {
    onReady();
    return;
  }
  if (!INDEX_PROMISE) {
    INDEX_PROMISE = fetch('/palette-index.json')
      .then((r) => r.json() as Promise<PaletteIndex>)
      .then((idx) => {
        INDEX = idx;
      })
      .catch(() => {
        // Offline / missing endpoint: fall back to an empty index so the
        // index-independent commands (Actions, theme toggle) still work.
        INDEX = { items: [], themes: [], version: '' };
      });
  }
  INDEX_PROMISE.then(onReady);
}

// --- small helpers ----------------------------------------------------------
function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }) as Record<
        string,
        string
      >)[c],
  );
}
function readMode(): Mode {
  try {
    const m = localStorage.getItem('theme:mode');
    return m === 'light' || m === 'dark' ? m : m === 'system' ? m : 'system';
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
function effectiveDark(mode: Mode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return matchMedia('(prefers-color-scheme: dark)').matches;
}
function reducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

class CommandPalette extends HTMLElement {
  private overlay!: HTMLElement;
  private input!: HTMLInputElement;
  private list!: HTMLElement;
  private live!: HTMLElement;

  private base: Cmd[] = [];
  private content: Cmd[] = []; // Pagefind results for the current query
  private optCmds: Cmd[] = []; // rendered options, in DOM order
  private active = -1;
  private opened = false;
  private query = '';
  private invoker: HTMLElement | null = null;
  private closeTimer = 0;

  // Pagefind: undefined = not tried, null = failed (astro dev), else the module.
  private pf: unknown;
  private pfToken = 0;

  connectedCallback(): void {
    this.overlay = this.querySelector('[data-cmdk-overlay]')!;
    this.input = this.querySelector('[data-cmdk-input]')!;
    this.list = this.querySelector('[data-cmdk-list]')!;
    this.live = this.querySelector('[data-cmdk-live]')!;

    this.overlay.addEventListener('mousedown', () => this.close());
    this.input.addEventListener('input', () => this.onInput());
    this.addEventListener('keydown', (e) => this.onKeydown(e));
    this.list.addEventListener('mousedown', (e) => this.onListPointer(e));
    this.list.addEventListener('mouseover', (e) => this.onListHover(e));

    // Warm the index in the background so the first open is instant.
    loadIndex(() => {
      this.buildBase();
      if (this.opened) this.render();
    });
  }

  disconnectedCallback(): void {
    if (this.opened) this.unlockScroll();
  }

  // --- open / close ---------------------------------------------------------
  open(): void {
    if (this.opened) return;
    this.opened = true;
    window.clearTimeout(this.closeTimer);
    this.invoker = document.activeElement as HTMLElement | null;
    this.lockScroll();
    this.hidden = false;
    this.buildBase();
    this.input.value = '';
    this.query = '';
    this.content = [];
    this.input.setAttribute('aria-expanded', 'true');
    this.render();
    // Next frame so the CSS open transition runs from the closed state.
    requestAnimationFrame(() => this.setAttribute('data-open', ''));
    this.input.focus();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.removeAttribute('data-open');
    this.input.setAttribute('aria-expanded', 'false');
    this.unlockScroll();
    const done = () => {
      if (!this.opened) this.hidden = true;
    };
    if (reducedMotion()) done();
    else this.closeTimer = window.setTimeout(done, 100);
    this.invoker?.focus?.();
  }

  private lockScroll(): void {
    document.documentElement.style.overflow = 'hidden';
  }
  private unlockScroll(): void {
    document.documentElement.style.overflow = '';
  }

  // --- command construction -------------------------------------------------
  private buildBase(): void {
    const idx = INDEX ?? { items: [], themes: [], version: '' };
    const cmds: Cmd[] = [];

    for (const it of idx.items) {
      if (it.type === 'essay') continue;
      cmds.push({
        id: 'j-' + it.slug,
        group: 0,
        title: it.title,
        sub: it.href,
        hint: 'Open',
        search: it.title,
        searchSub: it.tagline,
        run: (nt) => this.navigate(it.href, nt),
      });
    }
    for (const it of idx.items) {
      if (it.type !== 'essay') continue;
      cmds.push({
        id: 'e-' + it.slug,
        group: 1,
        title: it.title,
        sub: it.tagline,
        hint: '↗',
        external: true,
        search: it.title,
        searchSub: it.tagline,
        run: () => this.openExternal(it.href),
      });
    }
    const mode = readMode();
    const dark = effectiveDark(mode);
    for (const th of idx.themes) {
      cmds.push({
        id: 't-' + th.family,
        group: 2,
        title: 'Theme: ' + th.name,
        sub: 'Apply theme family',
        hint: 'Apply',
        accent: dark ? th.dark : th.light,
        keepOpen: true,
        search: 'theme ' + th.name,
        searchSub: th.name,
        run: () => window.__setTheme?.(th.family, readMode()),
      });
    }
    cmds.push({
      id: 't-toggle',
      group: 2,
      title: 'Toggle light / dark',
      sub: 'Switch the active mode',
      hint: 'Toggle',
      keepOpen: true,
      search: 'toggle light dark mode',
      searchSub: 'mode',
      run: () => window.__setTheme?.(readFamily(), effectiveDark(readMode()) ? 'light' : 'dark'),
    });

    cmds.push({
      id: 'a-copy',
      group: 3,
      title: 'Copy URL',
      sub: 'Copy this page link to the clipboard',
      hint: '⌘C',
      search: 'copy url link clipboard',
      searchSub: 'clipboard',
      run: () => this.copyUrl(),
    });
    cmds.push({
      id: 'a-repo',
      group: 3,
      title: 'Open repo for current page',
      sub: 'View the source on GitHub',
      hint: '↗',
      external: true,
      search: 'open repo github source current page',
      searchSub: 'github source',
      run: () => this.openExternal(repoForPath(location.pathname)),
    });
    cmds.push({
      id: 'a-colophon',
      group: 3,
      title: 'Go to colophon',
      sub: 'The theme pipeline and type specimen',
      hint: 'Open',
      search: 'go to colophon theme pipeline palette specimen',
      searchSub: 'colophon theme',
      run: (nt) => this.navigate('/colophon', nt),
    });

    this.base = cmds;
  }

  // --- actions --------------------------------------------------------------
  private navigate(href: string, newTab: boolean): void {
    if (newTab) {
      window.open(href, '_blank', 'noopener');
      return;
    }
    // Route through a synthetic <a> so Astro's ClientRouter animates the swap.
    const a = document.createElement('a');
    a.href = href;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  private openExternal(href: string): void {
    window.open(href, '_blank', 'noopener');
  }
  private copyUrl(): void {
    try {
      navigator.clipboard?.writeText(location.href);
      this.announce('Copied page URL');
    } catch {
      /* clipboard blocked: no-op */
    }
  }

  // --- input / filtering ----------------------------------------------------
  private onInput(): void {
    this.query = this.input.value.trim();
    if (this.query.length >= PF_MIN) this.runPagefind(this.query);
    else if (this.content.length) this.content = [];
    this.render();
  }

  private async runPagefind(q: string): Promise<void> {
    if (this.pf === null) return; // known-unavailable (dev)
    const token = ++this.pfToken;
    try {
      if (this.pf === undefined) {
        // Runtime-only import: the file exists only in the built /pagefind
        // bundle, so it is NOT statically resolvable. A variable specifier keeps
        // both Vite (build-time bundling) and tsc (module resolution) from
        // touching it; @vite-ignore silences Vite's dynamic-import warning.
        const spec = '/pagefind/pagefind.js';
        this.pf = await import(/* @vite-ignore */ spec);
      }
      const api = this.pf as {
        search: (q: string) => Promise<{ results: { data: () => Promise<PagefindDoc> }[] }>;
      };
      const res = await api.search(q);
      const docs = await Promise.all(res.results.slice(0, PF_LIMIT).map((r) => r.data()));
      if (token !== this.pfToken || this.query !== q) return; // stale
      this.content = docs.map((d, i) => ({
        id: 'c-' + i,
        group: 4,
        title: d.meta?.title || d.url,
        sub: (d.excerpt || '').replace(/<[^>]*>/g, ''),
        hint: 'Open',
        search: q,
        searchSub: '',
        run: (nt) => this.navigate(d.url, nt),
      }));
      this.render();
    } catch {
      this.pf = null; // astro dev ships no /pagefind -- omit Content silently
    }
  }

  // --- rendering ------------------------------------------------------------
  private render(): void {
    const q = this.query;
    const buckets: Cmd[][] = [[], [], [], [], []];

    if (!q) {
      for (const c of this.base) buckets[c.group].push(c);
      buckets[1] = buckets[1].slice(0, ESSAYS_EMPTY);
    } else {
      const scored: { c: Cmd; s: number }[][] = [[], [], [], [], []];
      for (const c of this.base) {
        const s = rankItem(q, c.search, c.searchSub);
        if (s > 0) scored[c.group].push({ c, s });
      }
      for (let g = 0; g < 4; g++) {
        scored[g].sort((a, b) => b.s - a.s);
        buckets[g] = scored[g].map((x) => x.c);
      }
      buckets[0] = buckets[0].slice(0, JUMP_QUERY);
      buckets[1] = buckets[1].slice(0, ESSAYS_QUERY);
      buckets[4] = this.content; // Pagefind order preserved (full-text relevance)
    }

    let html = '';
    const opts: Cmd[] = [];
    for (let g = 0; g < GROUPS.length; g++) {
      const cmds = buckets[g];
      if (!cmds.length) continue;
      const hid = 'cmdk-h' + g;
      html += `<div role="group" aria-labelledby="${hid}"><p class="cmdk-group" id="${hid}">${GROUPS[g]}</p>`;
      for (const c of cmds) {
        const oid = 'cmdk-o' + opts.length;
        opts.push(c);
        const dot = c.accent
          ? `<span class="cmdk-dot" style="background:${esc(c.accent)}" aria-hidden="true"></span>`
          : '';
        html +=
          `<div class="cmdk-opt" role="option" id="${oid}" aria-selected="false">` +
          dot +
          `<span class="cmdk-opt__text"><span class="cmdk-opt__title">${esc(c.title)}</span>` +
          (c.sub ? `<span class="cmdk-opt__sub">${esc(c.sub)}</span>` : '') +
          `</span><span class="cmdk-opt__hint">${esc(c.hint)}</span></div>`;
      }
      html += `</div>`;
    }
    if (!opts.length) {
      html = `<p class="cmdk-empty">No matches${q ? ` for "${esc(q)}"` : ''}</p>`;
    }

    this.list.innerHTML = html;
    this.optCmds = opts;
    this.setActive(opts.length ? 0 : -1);
    this.announce(`${opts.length} result${opts.length === 1 ? '' : 's'}`);
  }

  private setActive(i: number): void {
    const els = this.list.querySelectorAll<HTMLElement>('[role="option"]');
    if (this.active >= 0 && els[this.active]) {
      els[this.active].setAttribute('aria-selected', 'false');
      els[this.active].classList.remove('is-active');
    }
    this.active = i;
    if (i >= 0 && els[i]) {
      els[i].setAttribute('aria-selected', 'true');
      els[i].classList.add('is-active');
      els[i].scrollIntoView({ block: 'nearest' });
      this.input.setAttribute('aria-activedescendant', els[i].id);
    } else {
      this.input.removeAttribute('aria-activedescendant');
    }
  }

  private move(delta: number): void {
    const n = this.optCmds.length;
    if (!n) return;
    this.setActive((this.active + delta + n) % n);
  }

  private activate(newTab: boolean): void {
    const cmd = this.optCmds[this.active];
    if (!cmd) return;
    if (cmd.keepOpen) {
      cmd.run(newTab);
      // Re-derive theme accents/labels after a mode or family change.
      this.buildBase();
      this.render();
      return;
    }
    this.close();
    cmd.run(newTab);
  }

  private announce(msg: string): void {
    this.live.textContent = msg;
  }

  // --- keyboard / pointer ---------------------------------------------------
  private onKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        this.close();
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.move(-1);
        break;
      case 'Home':
        e.preventDefault();
        this.setActive(this.optCmds.length ? 0 : -1);
        break;
      case 'End':
        e.preventDefault();
        this.setActive(this.optCmds.length - 1);
        break;
      case 'Enter':
        e.preventDefault();
        this.activate(e.metaKey || e.ctrlKey);
        break;
      case 'Tab':
        // Trap focus: the input is the only tab stop inside the modal.
        e.preventDefault();
        break;
    }
  }

  private optIndexFrom(target: EventTarget | null): number {
    const el = (target as HTMLElement)?.closest?.('[role="option"]');
    if (!el) return -1;
    return Array.prototype.indexOf.call(
      this.list.querySelectorAll('[role="option"]'),
      el,
    ) as number;
  }
  private onListPointer(e: MouseEvent): void {
    const i = this.optIndexFrom(e.target);
    if (i < 0) return;
    e.preventDefault(); // keep focus on the input
    this.setActive(i);
    this.activate(e.metaKey || e.ctrlKey);
  }
  private onListHover(e: MouseEvent): void {
    const i = this.optIndexFrom(e.target);
    if (i >= 0 && i !== this.active) this.setActive(i);
  }
}

interface PagefindDoc {
  url: string;
  excerpt?: string;
  meta?: { title?: string };
}

declare global {
  interface Window {
    __setTheme?: (family: string, mode: Mode) => void;
  }
}

if (!customElements.get('command-palette')) {
  customElements.define('command-palette', CommandPalette);
}

export {};
