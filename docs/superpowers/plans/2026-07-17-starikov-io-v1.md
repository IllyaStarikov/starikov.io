# starikov.io v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild starikov.io as an Astro 5 static site on GitHub Pages — a design-award-level personal engineering hub whose theme system is generated from the real `~/.dotfiles` theme engine, with auto-generated `/bin/<tool>` pages, `/academia`, woven-in Ghost essays, and a ⌘K palette.

**Architecture:** Single Astro 5 repo; sibling repos (`.dotfiles`, `bin`, `academia`) are checked out read-only in CI and parsed at build time into content collections; Ghost Content API supplies essays; every remote source falls back live → `.cache` → committed vendor snapshot; a prebuild script turns dotfiles `colors.json` files into the site's CSS themes. Deploys via Actions → Pages; failed builds never deploy.

**Tech Stack:** Astro ^5, @astrojs/mdx, @astrojs/sitemap, @astrojs/rss, astro-pagefind, vitest, Shiki (`css-variables` theme), vanilla TS only (zero framework islands), GitHub Actions, GitHub Pages.

**Reference:** The approved design spec at `docs/superpowers/specs/2026-07-17-starikov-io-redesign-design.md` is normative for all visual/UX decisions. Read it before any presentational task (§4 design language, §5 theme system).

## Global Constraints

- Node 22, npm. `astro.config.mjs`: `site: 'https://starikov.io'`, **no `base`**. `public/CNAME` contains exactly `starikov.io`.
- **Zero framework islands.** All interactivity is vanilla TS. Budgets: JS ≤25KB gz (incl. deferred palette), CSS ≤30KB (themes ≤6KB gz), HTML ≤40KB/page, fonts ≤110KB total.
- Fonts: Inter Variable (body/UI, wght 400–600) + Commit Mono (identity mono), self-hosted woff2, `font-display: swap` with metric-adjusted fallbacks. Never commit non-open-licensed font binaries.
- **Theme contract:** one attribute `data-theme="<family>-<variant>"` on `<html>`; localStorage keys `theme:family`, `theme:mode` (`light|dark|system`); curated families (all with true light+dark pairs): `tokyonight, catppuccin, github, ayu, iceberg, nightowl, atomone, material`; explicit `webPair: {light, dark}` per family in `src/site.config.ts`; defaults family `tokyonight`, mode `system` (dark→`storm`, light→`day`); pre-paint blocking head script; re-apply on `astro:after-swap` (scripts marked `data-astro-rerun`); update `<meta name="theme-color">` on every application.
- **Token a11y:** raw terminal tokens (`--bg --fg --surface --border --muted --accent --accent-alt --selection --ansi-*`) are chrome-only; `--muted` is NEVER a text color; text uses `--fg` or derived `--text-secondary` (≥4.5:1 vs `--bg`) / `--code-comment` (≥3:1); no opacity on body text.
- Shiki configured with `theme: 'css-variables'`; `--astro-code-token-comment` maps to `--code-comment`, never `--muted`.
- Motion: CSS vars `--dur-1:100ms --dur-2:150ms --dur-3:200ms --dur-4:300ms`, `--ease-out: cubic-bezier(0.16,1,0.3,1)`; transform/opacity only (except the 120ms theme crossfade); everything gated by `prefers-reduced-motion`.
- **Never execute code from checked-out sibling repos.** Parse files only.
- Analytics: GA4 `G-MF94N59911`, `send_page_view: false`, manual `page_view` on `astro:page-load`.
- Build gates (CI sets `BUILD_STRICT=1`): min-counts `essays ≥ 50, tools ≥ 1, themeVariants ≥ 10, projects ≥ 4`; `scripts/validate-dist.mjs` must pass post-build.
- Excluded content: colosseum, economister. Keep GA tag and CNAME. Sibling repos are never modified by the build.
- Commit after every task with a conventional message; never commit `.sources/`, `.cache/`, `src/data/generated/`, `src/styles/themes.generated.css`, `dist/`.

**Local sources note:** In CI, sibling repos are checked out into `.sources/`. Locally, run `scripts/sync-sources.sh` (Task 3) which clones/pulls the same repos — or symlinks local copies: dotfiles at `~/.dotfiles`, bin at `~/Documents/development/bin`, academia cloned from GitHub.

---

### Task 1: Astro skeleton that builds

**Files:**
- Create: `package.json`, `astro.config.mjs`, `tsconfig.json`, `.gitignore`, `.nvmrc`
- Create: `public/CNAME`, `public/robots.txt`, `public/favicon.svg`
- Create: `src/layouts/Base.astro`, `src/pages/index.astro`, `src/site.config.ts`
- Delete: repo-root `README.md` content is replaced later (Task 20); leave file untouched now.

**Interfaces:**
- Produces: `Base.astro` with slots + `<slot name="head" />`; `SITE` config object from `src/site.config.ts` `{ title: string, description: string, origin: 'https://starikov.io', gaId: 'G-MF94N59911', curatedFamilies, webPairs, minCounts }` (theme fields consumed from Task 3 on).

- [ ] **Step 1: Scaffold**

```bash
cd "$REPO" && npm create astro@latest . -- --template minimal --no-install --no-git --typescript strict --yes 2>/dev/null || true
npm i astro@^5 @astrojs/mdx @astrojs/sitemap @astrojs/rss
npm i -D vitest linkedom
echo "22" > .nvmrc
```

If `create astro` balks at the non-empty dir, hand-write `package.json` with scripts: `"dev": "astro dev"`, `"build": "node scripts/build-themes.mjs && astro build && node scripts/validate-dist.mjs"`, `"test": "vitest run"`, `"preview": "astro preview"`. (Until Task 3/15 exist, `build` may be just `astro build`; update it in those tasks.)

- [ ] **Step 2: Config files**

`astro.config.mjs`:
```js
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://starikov.io',
  integrations: [mdx(), sitemap()],
  markdown: { shikiConfig: { theme: 'css-variables' } },
});
```

`public/CNAME`: `starikov.io` (single line). `public/robots.txt`:
```
User-agent: *
Allow: /
Sitemap: https://starikov.io/sitemap-index.xml
```

`public/favicon.svg` — the `❯` glyph:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style>text{fill:#1a1b26}@media(prefers-color-scheme:dark){text{fill:#c0caf5}}</style><text x="50" y="72" font-family="ui-monospace,Menlo,monospace" font-size="72" font-weight="700" text-anchor="middle">&#10095;</text></svg>
```

`.gitignore` additions: `node_modules/ dist/ .astro/ .sources/ .cache/ src/data/generated/ src/styles/themes.generated.css public/media/`

- [ ] **Step 3: Base layout with GA**

`src/layouts/Base.astro` — html/head/body shell: charset, viewport, title/description props, favicon link, `<meta name="theme-color">` placeholder, GA snippet exactly:
```html
<script is:inline async src="https://www.googletagmanager.com/gtag/js?id=G-MF94N59911"></script>
<script is:inline>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-MF94N59911', { send_page_view: false });
  document.addEventListener('astro:page-load', () => gtag('event', 'page_view', {
    page_location: location.href, page_title: document.title }));
</script>
```
`src/pages/index.astro`: minimal "starikov.io — rebuilding" page using Base.

Security note: `gtag.js` cannot carry `integrity=` (Google serves per-property, mutating content — a pinned SRI hash breaks silently), and GitHub Pages cannot set response headers. Mitigate with a CSP meta tag in Base.astro `<head>` instead, and keep it current as features land (Task 16 adds no external origins; Pagefind is same-origin):

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; frame-src https://academia.starikov.io; base-uri 'none'; object-src 'none'">
```

(`'unsafe-inline'` for scripts is required by the theme boot + GA bootstrap inline snippets; acceptable on a fully static site with no user-generated content. Revisit with hashes in v1.1 if desired.)

- [ ] **Step 4: Verify build**

Run: `npm run build` → Expected: `dist/index.html` exists, contains the GA id; `dist/CNAME` exists. Run `npx astro check` → no errors.

- [ ] **Step 5: Commit** — `feat: scaffold Astro 5 skeleton with CNAME, GA, base layout`

---

### Task 2: Deploy to Pages via Actions

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Produces: the deploy workflow later tasks extend (checkout steps in Task 6, secrets/gates in Tasks 14–15, cache in Task 10).

- [ ] **Step 1: Workflow (self-checkout only for now)**

```yaml
name: Deploy
on:
  push: { branches: [main] }
  workflow_dispatch:
  schedule: [{ cron: '17 9 * * *' }]
  repository_dispatch: { types: [content-update] }
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: false }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run build
        env: { BUILD_STRICT: "1" }
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

- [ ] **Step 2: Switch Pages source to Actions**

Run: `gh api -X PUT repos/IllyaStarikov/starikov.io/pages -f build_type=workflow` (if 404, `-X POST` first). Verify: `gh api repos/IllyaStarikov/starikov.io/pages -q .build_type` → `workflow`.

- [ ] **Step 3: Push and verify live**

Push main; `gh run watch` until green; `curl -sI https://starikov.io | head -3` → `200`, and page body contains "rebuilding". **The old README site is now replaced — this is the point of no return; confirm the placeholder looks intentional (it will say "rebuilding").**

- [ ] **Step 4: Commit** — (workflow committed in Step 1's push) `ci: deploy to GitHub Pages via Actions`

---

### Task 3: Theme build script (the signature engine)

**Files:**
- Create: `scripts/build-themes.mjs`, `scripts/lib/contrast.mjs`, `scripts/sync-sources.sh`, `scripts/refresh-snapshots.mjs`
- Create: `src/data/vendor/themes-snapshot/` (committed copy of manifest + curated colors.json files)
- Modify: `src/site.config.ts` (add theme config), `package.json` (build script order)
- Test: `test/contrast.test.mjs`, `test/build-themes.test.mjs`

**Interfaces:**
- Consumes: `.sources/dotfiles/config/themes.json` manifest `{ defaults: {light, dark}, families: {<fam>: {name, variants: {<var>: {display_name, mode}}}} }` and `.sources/dotfiles/src/theme/<family>/<variant>/colors.json` (26 keys: `accent accent_alt bg surface border muted fg cursor selection_bg name` + 16 ANSI names).
- Produces: `src/styles/themes.generated.css` (one `[data-theme="fam-var"]` block per curated variant) and `src/data/generated/themes.json`: `{ defaults: {light: 'tokyonight-day', dark: 'tokyonight-storm'}, families: [{ id, name, pair: {light, dark}, variants: [{ id, variantId, name, mode, swatch: {bg, fg, accent} }] }] }`. Function `deriveTextTokens(fg, bg)` from `contrast.mjs` returns `{ textSecondary, codeComment }`.

- [ ] **Step 1: Contrast lib + failing tests**

`scripts/lib/contrast.mjs`: `relLuminance(hex)`, `contrastRatio(a, b)` (WCAG 2.x formulas), and:
```js
// Mix fg toward bg in sRGB until the LAST step that still meets `floor` vs bg.
export function deriveToFloor(fg, bg, floor) {
  let best = fg;
  for (let t = 0; t <= 0.7; t += 0.02) {
    const c = mix(fg, bg, t);
    if (contrastRatio(c, bg) >= floor) best = c; else break;
  }
  return best;
}
export const deriveTextTokens = (fg, bg) => ({
  textSecondary: deriveToFloor(fg, bg, 4.5),
  codeComment: deriveToFloor(fg, bg, 3.0),
});
```
Tests (`test/contrast.test.mjs`): known pairs — `contrastRatio('#ffffff','#000000')` = 21±0.01; tokyonight/storm `fg:#c0caf5 bg:#24283b` ≥ 4.5; `deriveTextTokens` outputs meet their floors for storm AND for tokyonight/day (`fg:#3760bf bg:#e1e2e7`) AND for a pathological low-contrast pair (returns something ≥ floor or falls back to fg). Run `npx vitest run test/contrast.test.mjs` → fails (module missing) → implement → passes.

- [ ] **Step 2: build-themes.mjs**

Logic (all synchronous fs, no deps beyond `astro/zod`— import zod from `zod` devDep if cleaner: `npm i -D zod`):
1. Resolve source dir: `.sources/dotfiles` if exists, else `src/data/vendor/themes-snapshot` (log `::warning::themes: using vendored snapshot`).
2. Zod-validate manifest + each curated `colors.json` (`/^#[0-9a-fA-F]{6}$/` on all color fields). Invalid variant → skip + `::warning::`; < 10 surviving variants → if reading live, retry from snapshot; if reading snapshot → `process.exit(1)` with `::error::`.
3. For each family in `SITE.curatedFamilies`, for each variant with `mode` in manifest: emit CSS block:
```css
[data-theme="tokyonight-storm"] {
  color-scheme: dark;
  --bg:#24283b; --fg:#c0caf5; --surface:…; --border:…; --muted:…;
  --accent:…; --accent-alt:…; --selection:…;
  --text-secondary:<derived>; --code-comment:<derived>;
  --surface-raised:color-mix(in srgb, var(--surface) 85%, var(--fg));
  --surface-hover:color-mix(in srgb, var(--bg) 92%, var(--fg));
  --focus-ring:color-mix(in srgb, var(--accent) 60%, transparent);
  --ok:<green> --warn:<yellow> --err:<red>;
  --astro-code-foreground:var(--fg); --astro-code-background:var(--surface);
  --astro-code-token-keyword:<magenta>; --astro-code-token-string:<green>;
  --astro-code-token-function:<blue>; --astro-code-token-constant:<yellow>;
  --astro-code-token-comment:var(--code-comment);
  --astro-code-token-parameter:<cyan>; --astro-code-token-string-expression:<green>;
  --astro-code-token-punctuation:var(--text-secondary); --astro-code-token-link:<blue>;
}
```
   (ANSI vars: emit only `--ansi-black`, `--ansi-red`, `--ansi-green`, `--ansi-yellow`, `--ansi-blue`, `--ansi-magenta`, `--ansi-cyan` — the system card + 404 consume these; not all 16.)
4. Validate every emitted block: `fg/bg ≥ 4.5` else drop variant + warn.
5. Compute `pair` per family from `SITE.webPairs` (error if a named variant is missing).
6. Write `themes.generated.css` + `themes.json` (shape above; `id` = `family-variant`).
7. Print summary line: `themes: N families, M variants, css X KB`.

`src/site.config.ts` additions:
```ts
export const SITE = {
  title: 'starikov.io', description: 'Illya Starikov — software engineer. The workshop.',
  origin: 'https://starikov.io', gaId: 'G-MF94N59911',
  curatedFamilies: ['tokyonight','catppuccin','github','ayu','iceberg','nightowl','atomone','material'],
  webPairs: { tokyonight: {light:'day',dark:'storm'}, catppuccin:{light:'latte',dark:'mocha'},
    github:{light:'light_default',dark:'dark_default'}, ayu:{light:'light',dark:'dark'},
    iceberg:{light:'light',dark:'dark'}, nightowl:{light:'light',dark:'dark'},
    atomone:{light:'light',dark:'dark'}, material:{light:'lighter',dark:'darker'} },
  minCounts: { essays: 50, tools: 1, themeVariants: 10, projects: 4 },
} as const;
```
**Before finalizing `webPairs`, verify each variant id against `.sources/dotfiles/config/themes.json` — the values above are best-effort from the survey; correct them to the manifest's actual variant keys and re-run tests.**

- [ ] **Step 3: sync + snapshot scripts**

`scripts/sync-sources.sh`: for `dotfiles→IllyaStarikov/.dotfiles`, `bin→IllyaStarikov/bin`, `academia→IllyaStarikov/academia`: shallow-clone or `git -C pull` into `.sources/<name>`. `scripts/refresh-snapshots.mjs`: copy `config/themes.json` + curated families' `colors.json` from `.sources/dotfiles` into `src/data/vendor/themes-snapshot/` (preserving relative layout), validating first. Run sync then refresh once now; commit the snapshot.

- [ ] **Step 4: Tests for the pipeline**

`test/build-themes.test.mjs`: run the script via `execFileSync('node', ['scripts/build-themes.mjs'])` against a fixture dir (`test/fixtures/themes-ok/`, a two-family miniature copied from the snapshot; point via env `THEMES_SOURCE_DIR`): asserts generated CSS contains `[data-theme="tokyonight-storm"]`, `--code-comment`, and NOT `--astro-code-token-comment:var(--muted)`; themes.json has pairs resolving to existing ids. Second fixture `themes-corrupt/` (bad hex): with env pointing at it as snapshot → exit code 1. Run: `npx vitest run` → all pass.

- [ ] **Step 5: Wire into build + commit**

`package.json` build: `node scripts/build-themes.mjs && astro build`. Local `npm run build` passes. Commit — `feat: generate site themes from dotfiles theme engine with a11y-derived text tokens`

---

### Task 4: Design tokens, fonts, global CSS

**Files:**
- Create: `src/styles/tokens.css`, `src/styles/global.css`, `src/assets/fonts/` (woff2 files)
- Modify: `src/layouts/Base.astro` (import styles, preload fonts)

**Interfaces:**
- Produces: the CSS custom properties every component consumes: spacing scale `--s-1..--s-9` (4→96px), type scale classes/vars (`--fs-12/13/14/16/20/24/32/44`), motion tokens (Global Constraints), font stacks `--font-sans`, `--font-mono`; prose styles under `.prose`.

- [ ] **Step 1: Fonts**

```bash
npm i @fontsource-variable/inter @fontsource/commit-mono
```
Import in Base.astro frontmatter: `import '@fontsource-variable/inter';` + commit-mono weights 400/700. If `@fontsource/commit-mono` doesn't exist on npm, download woff2 from https://commitmono.com (MIT-licensed) into `src/assets/fonts/` and hand-write `@font-face` in tokens.css. Add metric-adjusted local fallback:
```css
@font-face { font-family: 'Inter Fallback'; src: local('Helvetica Neue'), local('Arial');
  size-adjust: 107%; ascent-override: 90%; descent-override: 22.5%; line-gap-override: 0%; }
```
`--font-sans: 'Inter Variable','Inter Fallback',system-ui,sans-serif; --font-mono:'Commit Mono',ui-monospace,'SF Mono',Menlo,monospace;`

- [ ] **Step 2: tokens.css + global.css**

tokens.css: spacing/type/motion/radius vars from Global Constraints + spec §4; `:root { color-scheme: light dark; }`. global.css: reset-lite; body `background: var(--bg); color: var(--fg); font: 400 16px/1.5 var(--font-sans);`; `.mono-label { font: 500 12px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .04em; color: var(--text-secondary); }`; link style (always-underlined, `text-decoration-color: var(--border)` → `--accent` on hover, 150ms); `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`; `@media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation: none !important; transition: none !important; } }`; `.theme-transitioning * { transition: background-color 120ms linear, border-color 120ms linear, color 120ms linear !important; }`; prose styles (720px measure, headings per scale, code blocks `background: var(--surface); border: 1px solid var(--border); border-radius: 10px`).

- [ ] **Step 3: Verify + commit**

`npm run build`; view `npx astro preview` — fonts load (Network tab: woff2 from self, none from Google), text renders in Inter/Commit Mono. Commit — `feat: design tokens, self-hosted fonts, global styles`

---

### Task 5: Theme runtime (boot script + picker + ClientRouter survival)

**Files:**
- Create: `src/lib/theme-boot.ts`, `src/components/ThemeControl.astro`, `src/scripts/theme-control.ts`
- Modify: `src/layouts/Base.astro`
- Test: `test/theme-boot.test.mjs`

**Interfaces:**
- Consumes: `src/data/generated/themes.json` (Task 3 shape).
- Produces: `THEME_BOOT_SRC` (string of inline JS); global runtime API `window.__setTheme(family: string, mode: 'light'|'dark'|'system')` used by ⌘K (Task 17); CustomEvent `'themechange'` on document.

- [ ] **Step 1: Boot module + failing test**

`src/lib/theme-boot.ts` exports a template-built string `THEME_BOOT_SRC` embedding `defaults` and a compact `{family → pair}` map imported from the generated themes.json at build time. The script body (runs pre-paint AND on re-run):
```js
(function(){
  var P = __PAIRS__, D = __DEFAULTS__;
  function resolve(f, m) {
    var sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
    var mode = m === 'system' || !m ? (sysDark ? 'dark' : 'light') : m;
    var fam = P[f] ? f : D.family;
    var v = P[fam][mode] || P[D.family][mode];
    return fam + '-' + v;
  }
  function apply() {
    var f = localStorage.getItem('theme:family') || D.family;
    var m = localStorage.getItem('theme:mode') || 'system';
    var t = resolve(f, m);
    document.documentElement.dataset.theme = t;
    var meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '';
  }
  apply();
  window.__applyTheme = apply;
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(){
    if ((localStorage.getItem('theme:mode') || 'system') === 'system') apply(); });
  document.addEventListener('astro:after-swap', apply);
})();
```
`window.__setTheme = (f, m) => { localStorage.setItem('theme:family', f); localStorage.setItem('theme:mode', m); document.documentElement.classList.add('theme-transitioning'); window.__applyTheme(); setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 200); document.dispatchEvent(new CustomEvent('themechange')); }` lives in theme-control.ts (not the boot script).

Test (`test/theme-boot.test.mjs`, vitest + linkedom): eval `THEME_BOOT_SRC` with stubbed `matchMedia`/`localStorage`/document — asserts: no storage → `tokyonight-storm` under dark system; `theme:family=catppuccin, theme:mode=light` → `catppuccin-latte`; unknown family → default. Fail → implement → pass.

- [ ] **Step 2: Inject in Base.astro head (order matters: after themes CSS link, before body)**

```astro
<script is:inline data-astro-rerun set:html={THEME_BOOT_SRC} />
```
Import `src/styles/themes.generated.css` in Base. Add `<meta name="theme-color" content="">`.

- [ ] **Step 3: ThemeControl popover**

`ThemeControl.astro` + `theme-control.ts` (loaded `type="module"`): button (accent dot + family name) → popover listing families from themes.json, each row inline-styled with that family's own `swatch` colors (`style="background:${bg};color:${fg}"` + accent dot), mode segmented control (light/dark/system); rows call `__setTheme`; popover is a `<dialog>` or positioned div with proper `aria-expanded`/`aria-controls`, Esc/outside-click close. Footer line 12px mono: `Generated from ~/.dotfiles/src/theme — the same colors.json that themes my terminal. → /colophon`.

- [ ] **Step 4: Verify E2E**

`npm run dev`; in browser: switch to each of the 8 families in both modes — background/code colors change, no flash on hard refresh (throttle CPU to check), `theme-color` meta updates, system-mode follows OS toggle. Then add `<ClientRouter />` NOW (import from `astro:transitions` in Base head) and verify: pick Catppuccin → navigate between two pages → theme persists → hard refresh → persists. Commit — `feat: theme runtime with pre-paint boot, picker, view-transition survival`

---

### Task 6: CI checkout of dotfiles + snapshot fallback proof

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Add sparse checkout before npm ci**

```yaml
      - uses: actions/checkout@v4
        with:
          repository: IllyaStarikov/.dotfiles
          path: .sources/dotfiles
          sparse-checkout: |
            config/themes.json
            src/theme
          sparse-checkout-cone-mode: false
```

- [ ] **Step 2: Verify both paths**

Push; CI log shows `themes: 8 families, ~16 variants`. Then locally: `rm -rf .sources/dotfiles && npm run build` → succeeds with snapshot warning. Restore with `scripts/sync-sources.sh`. Commit — `ci: source themes from live dotfiles checkout`

---

### Task 7: App shell (sidebar, breadcrumbs, right rail)

**Files:**
- Create: `src/layouts/Shell.astro`, `src/components/{Sidebar,Breadcrumbs,RightRail,LedgerRow,MetadataStrip,Kbd}.astro`, `src/scripts/shell.ts`
- Modify: `src/layouts/Base.astro` (skip link), `src/pages/index.astro` (use Shell)

**Interfaces:**
- Consumes: nav data — hardcode structure now, tools group populated from `getCollection('tools')` after Task 9 (leave a `/* tools injected Task 9 */` seam via optional prop `tools: {slug,title}[]`).
- Produces: `Shell.astro` props `{ title, description?, crumbs?: {href,label}[], toc?: {id,label}[] }`; `LedgerRow.astro` props `{ href, title, dek?, meta?: string[], external?: boolean }`. All later pages render inside Shell.

- [ ] **Step 1: Build the shell per spec §3**

Desktop grid `240px / minmax(0,1fr) / 224px` (rail hidden <1280px, sidebar → top bar <1024px with a full-screen nav `<dialog>`). Sidebar: wordmark `~/starikov` + `▊` cursor (CSS animation, 2 blinks via `animation-iteration-count: 2`), fake-input `Search… ⌘K` button (dispatches `open-palette` CustomEvent), nav groups with `.mono-label` headers (groups >8 items: slice 8 by `updated` desc + "All N →"), footer: ThemeControl + GitHub link. Active item: 2px accent bar, `transform` FLIP slide 180ms in shell.ts (progressive enhancement — correct static position without JS). Sidebar wrapped in `transition:persist`. Breadcrumbs: mono path segments, each a link. RightRail: TOC list (scrollspy via IntersectionObserver in shell.ts) + slot for Connections (renders only when the passed array has ≥2 items — enforced in the component). Page transition styles per spec §4 motion table.

- [ ] **Step 2: Verify + commit**

Build; keyboard-walk the whole shell (tab order, skip link first, dialog traps focus); mobile viewport check at 375px. Lighthouse a11y on `/` = 100. Commit — `feat: app shell — sidebar, breadcrumbs, right rail, mobile nav`

---

### Task 8: Markdown section/table parser (shared loader lib)

**Files:**
- Create: `src/loaders/lib/markdown-tables.ts`, `src/loaders/lib/report.ts`
- Create: `test/fixtures/bin/pocketcasts-reset-README.md` (copy the REAL file from `.sources/bin/pocketcasts-reset/README.md`)
- Test: `test/markdown-tables.test.ts`

**Interfaces:**
- Produces:
```ts
export interface ParsedReadme { h1: string | null; intro: string; // markdown before first H2
  sections: Record<string, string>; // H2 heading text (lowercased, trimmed) → markdown incl. any H3s
  tables: { heading: string; rows: string[][] }[] } // every pipe table with its nearest heading
export function parseReadme(md: string): ParsedReadme;
export function parseScriptsTable(md: string): { name: string; tagline: string }[]; // root README "## Scripts"
// report.ts:
export const report = { warn(source: string, msg: string): void, error(...): void,
  flush(): {warnings: number, errors: number} }; // prints ::warning::/::error:: annotations
```
- Uses `remark-parse` + `unified` (add deps: `npm i unified remark-parse remark-gfm mdast-util-to-markdown`).

- [ ] **Step 1: Failing tests against the REAL fixture**

Tests assert on the actual pocketcasts-reset README: h1 = `pocketcasts-reset`; intro non-empty; `sections` has `usage` containing the `### Credentials` H3 text; the Options table (4 rows: `--dry-run --yes --email --delay`) is found even though it's an H3 under Usage; the "How it works" table (endpoint rows) is captured under its heading; `sections.license` exists. Plus synthetic fixtures: README with no Options (→ no options table), no H1 (→ h1 null).

- [ ] **Step 2: Implement → tests pass → commit** — `feat: shared README section/table parser with real-world fixture`

---

### Task 9: bin loader + /bin pages

**Files:**
- Create: `src/loaders/bin-tools.ts`, `src/content.config.ts`, `src/pages/bin/index.astro`, `src/pages/bin/[tool].astro`, `src/lib/model.ts` (first slice)
- Modify: `.github/workflows/deploy.yml` (add bin checkout), `src/components/Sidebar` nav seam
- Test: `test/bin-loader.test.ts`

**Interfaces:**
- Consumes: `parseReadme`/`parseScriptsTable` (Task 8 signatures).
- Produces: collection `tools` (Zod schema exactly as spec §6 / pipeline doc §1.1: `name, tagline, description, language?, sections{requirements?,usage?,howItWorks?,caveats?}, options[], sourceUrl`); `getToolPage(slug)` in model.ts returning merged auto+overlay per spec overlay rule; `SiteItem` type `{ type:'tool'|'project'|'essay'|'page', slug, title, tagline, href, date? }` + `getAllItems()`.

- [ ] **Step 1: Loader with failing test**

`binToolsLoader({ root })`: enumerate dirs with README.md; slug = dir name; parse; render markdown sections to HTML via loader context `renderMarkdown`; language from file extensions in dir (`.py`→Python, `.sh|.zsh`→Shell, `.rs`→Rust, else omit); tagline from root Scripts table else first sentence; cross-check table↔dirs → `report.warn`; malformed (no H1) → skip + warn; `generateDigest` on README text. **Never executes tool code.** Test with fixture dir mirroring bin's layout.

- [ ] **Step 2: Pages**

`/bin`: intro line + LedgerRows (name mono, tagline, language meta). `/bin/[tool]` via `getStaticPaths` over the collection: breadcrumb `~/bin/<tool>`; NAME (h1 + tagline callout in surface box); SYNOPSIS (usage HTML, copy button); OPTIONS two-column table (flag pills mono in accent) only if `options.length`; HOW IT WORKS / CAVEATS if present; SOURCE (repo link + `git clone` line). Right rail TOC from present sections + facts (language, license, `stdlib-only` badge when README Requirements says none). Sections absent → nothing rendered (no empty scaffolding).

- [ ] **Step 3: CI checkout + verify**

Add `- uses: actions/checkout@v4` with `repository: IllyaStarikov/bin, path: .sources/bin`. Local build → `dist/bin/pocketcasts-reset/index.html` exists, contains all four flags; `dist/bin/index.html` lists the tool. `npx vitest run` green. Commit — `feat: auto-generated /bin from bin repo READMEs`

---

### Task 10: academia loader + /academia page + media pipeline

**Files:**
- Create: `src/loaders/academia.ts`, `scripts/transcode-media.mjs`, `src/pages/academia/index.astro`, `src/assets/academia/` (4 committed PDF first-page thumbnails)
- Modify: `content.config.ts` (+`academiaShowcase`, `courses`), `deploy.yml` (+academia checkout, ffmpeg cache), `package.json` (prebuild chain)
- Test: `test/academia-loader.test.ts` (PORTFOLIO.md fixture excerpt)

**Interfaces:**
- Consumes: `.sources/academia/PORTFOLIO.md` (`## Documents` table; `## N. Title` sections with `**Path:**` + `<img src="assets/*.gif">`), `src/<course-slug>/` dirs, `latex/<course_underscored>/` dirs.
- Produces: collections per spec §6; `PDF_VOLUMES` const in site.config: `[{slug:'curated',title:'Curated',pages:284},{slug:'notes',…473},{slug:'assignments',…498},{slug:'complete',…1113}]` with URLs `https://academia.starikov.io/<slug>.pdf` (**root paths — verified; NOT /latex/**); transcoded media at `public/media/academia/<name>.{mp4,webm,jpg}`.

- [ ] **Step 1: Loader + tests** (parse fixture: order/title/srcPath/media extracted; archived-repo policy: any parse failure → `report.error` + non-zero exit in strict mode)

- [ ] **Step 2: transcode-media.mjs**

For each GIF referenced by the showcase: `ffmpeg -i in.gif -movflags faststart -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" out.mp4` + `-c:v libvpx-vp9 out.webm` + first-frame `out.jpg` poster — skipped when digest file `public/media/academia/.digests.json` matches source hash. Runs in prebuild chain before astro build. CI: ubuntu runner has ffmpeg; assert with `ffmpeg -version || (echo '::error::ffmpeg missing' && exit 1)`. Cache `public/media` + digests via `actions/cache` keyed on academia checkout SHA.

- [ ] **Step 3: PDF thumbnails (one-time, committed)**

Locally: `for v in curated notes assignments complete; do curl -sO https://academia.starikov.io/$v.pdf && pdftoppm -jpeg -f 1 -l 1 -scale-to 800 $v.pdf src/assets/academia/$v; done` (needs `brew install poppler`). Commit the 4 JPGs; delete downloaded PDFs.

- [ ] **Step 4: /academia page** per spec §3/§6: header (degree line, mono stat strip: 34 courses · 147 assignments · 91.5K LOC · 9 languages), archived note, Four Volumes shelf (thumbnail, page count, `Open PDF ↗`), Selected Projects media ledger (grouped AI/graphics/games/systems; `<video muted loop playsinline preload="none" poster=…>` with IntersectionObserver play/pause in shared utilities script), course index table (unlinked rows). Verify: build; all four volume links `curl -sI` 200; videos autoplay on scroll in preview. Commit — `feat: /academia with volumes shelf, transcoded project demos, course index`

---

### Task 11: GitHub metadata loader + resilience lib

**Files:**
- Create: `src/loaders/github-meta.ts`, `src/loaders/lib/fallback.ts`, `src/data/vendor/github-meta.json`
- Modify: `content.config.ts` (+`repos`)
- Test: `test/fallback.test.ts`

**Interfaces:**
- Produces: `withFallback<T>({ source: string, fetchLive: () => Promise<T>, cachePath: string, vendorPath: string, validate: (x:unknown) => T, onVendor?: 'warn'|'fail' }): Promise<{data: T, stale: boolean}>` — live → write `.cache` → on failure read `.cache` → vendor → policy. Collection `repos` (schema per spec §6, `stale` flag). Repo list = union of project frontmatter `repo`/`repos` + `SITE.extraRepos`.

- [ ] **Step 1: fallback.ts + tests** (mock fetchLive throwing → cache hit; both missing → vendor + stale; vendor invalid → throws)
- [ ] **Step 2: github-meta.ts** — plain `fetch('https://api.github.com/repos/'+full, {headers})` with `authorization: Bearer ${process.env.GITHUB_TOKEN}` when set; per-repo fallback; writes cache file. Seed `src/data/vendor/github-meta.json` by running the loader locally once (script mode: `node --experimental-strip-types src/loaders/github-meta.ts --seed` or a tiny `scripts/seed-github-meta.mjs`). Commit — `feat: GitHub metadata collection with live→cache→snapshot cascade`

---

### Task 12: projects collection + flagship pages

**Files:**
- Create: `src/content/projects/{dotfiles,eclecta,mcp-servers,artificial,resume,profile}.mdx`, `src/pages/projects/{index,[...slug]}.astro`, `src/components/{ProjectHero,RelatedEssays,ProvenanceFooter}.astro`
- Modify: `src/lib/model.ts` (`getProjectPage`, join repos data), `src/lib/related.ts` (stub returning `[]` until Task 14)

**Interfaces:**
- Consumes: `repos` collection (Task 11), overlay schema per spec §6 (`title, tagline, repo?, repos[], liveUrl?, featured, order, hero?, essays[], essayTags[], draft`).
- Produces: 6 project pages; `getProjectPage(slug)` returning `{ frontmatter, Content, repoMeta[], essays[] }`.

- [ ] **Step 1: Write the 6 MDX overlays.** dotfiles is the DEEP one (per spec §10) — sections: Story (why dotfiles matter, ~10 years), Highlights as numbered vignettes with real numbers (fixy 1,188 lines / 31 formatters / 60 filetypes; theme engine 57 variants / 8 apps / <500ms atomic switch; Neovim ~150ms startup / 53 plugins; 369 tests / 11 categories / 6 CI workflows), Architecture (src/test/doc layout), theme-engine code excerpt (Shiki-highlighted — recolors with site theme), hero image from the repo's `template/dotfiles.png` (route through `src/assets` → AVIF; fetch a copy into `src/assets/projects/` and commit). Others: hero + tagline + 2–4 paragraph story + metadata; eclecta links live site; mcp-servers clusters both repos (`repos: [omnifocus-mcp, readwise-mcp]`, npm install one-liner, demo video from repo gif via transcode script); resume embeds the four PDF links (light/dark variants); profile explains the auto-refreshing SVG card and displays it.
- [ ] **Step 2: Pages** — `/projects` ledger (featured pinned by `order`); `[...slug]` renders breadcrumb, H1+dek, MetadataStrip (language · ★stars · license · last commit relative · repo ↗ — omit stars when `stale`), hero media, overlay `<Content/>`, RelatedEssays (hidden while empty), Connections (≥2 rule), ProvenanceFooter (`Auto-generated from <repo>@<sha-short>; overlay last edited <git log -1 --format=%as -- file>`, sha read from `.sources/<repo>/.git` or omitted for API-only repos).
- [ ] **Step 3: Verify** — build: 6 pages present; dotfiles page contains "1,188" and a code block with `--astro-code` vars; stars render. Commit — `feat: flagship project pages with curated overlays over live repo metadata`

---

### Task 13: Home + 404

**Files:**
- Create: `src/components/SystemCard.astro`; rewrite `src/pages/index.astro`; create `src/pages/404.astro`

**Interfaces:**
- Consumes: `getAllItems()` (model.ts), collections built so far; `themes.json` for the card's theme row.
- Produces: the finished landing page per spec §5.

- [ ] **Step 1: Hero + system card.** Left: 44px statement (spec's copy: *"Illya Starikov — software engineer. This is the workshop: ten years of dotfiles, tools, coursework, and essays — documented like it matters."*), two-line dek in `--text-secondary`, mono links `browse the index →` and `press ⌘K`. Right: SystemCard — bordered surface panel, mono 13px, rows populated at build: `os`, `editor` (from dotfiles data: `neovim · 53 plugins · ~150ms`), `dotfiles 90.8K lines / 767 files`, `themes 57 variants / 17 families`, `essays N` (live count once Task 14 lands; until then from vendor snapshot), `latest <most recent cross-repo commit relative>`, `built <ISO timestamp>` — and the row `theme: tokyonight/storm ▾` which IS a button opening ThemeControl's popover (`aria-haspopup`). ANSI color strip along the card bottom using `--ansi-*` vars (neofetch signature).
- [ ] **Step 2: Below fold:** Start Here (4 LedgerRows: dotfiles, eclecta, mcp-servers, academia with mono meta: stars · lang · updated), Recently Updated (top 6 `SiteItem` by date), Latest essays (3, once essays exist — guard empty). First-visit stagger animation on rows (`animation` + `sessionStorage` guard).
- [ ] **Step 3: 404** — full shell intact; `zsh: command not found:` + echoed path (`<script>` reads `location.pathname` into a mono line — textContent only, never innerHTML), `did you mean:` + 3 static links + `press ⌘K`.
- [ ] **Step 4: Verify build + Lighthouse ≥95 on `/` locally (`npx lighthouse http://localhost:4321 --preset=desktop`). Commit** — `feat: landing page with live system card + terminal 404`

---

### Task 14: Ghost essays integration

**Files:**
- Create: `src/loaders/ghost.ts`, `src/data/vendor/ghost-snapshot.json`, `src/pages/writing/index.astro`
- Modify: `content.config.ts` (+`essays`, `essayTags`), `src/lib/related.ts` (real impl), home latest-essays, project pages' RelatedEssays
- Test: `test/related.test.ts`

**Interfaces:**
- Consumes: `withFallback` (Task 11), env `GHOST_CONTENT_API_KEY`.
- Produces: collections `essays` (`title,url,excerpt,featureImage,publishedAt,readingTime,tags[]`), `essayTags` (`name,slug,accentColor,description,count`); `resolveRelatedEssays(overlay): Promise<Essay[]>` — manual `essays:` slugs first (unknown slug → `report.warn` with filename), then `essayTags` match (most recent 3), else `[]`.

- [ ] **Step 1: Loader.** Fetch `https://starikov.co/ghost/api/content/posts/?key=$KEY&limit=all&include=tags&fields=title,slug,url,custom_excerpt,excerpt,feature_image,published_at,reading_time` + `/tags/?limit=all&include=count.posts` through `withFallback` (cache `.cache/ghost.json`, vendor snapshot, `onVendor:'warn'`); paginate via `meta.pagination` even though one page suffices.
- [ ] **Step 2: Seed secret + snapshot (user-visible actions).** Obtain a Content API key: Ghost Admin → Settings → Integrations → Add custom integration "starikov.io" → copy the **Content API key** (read-only). Then: `gh secret set GHOST_CONTENT_API_KEY -R IllyaStarikov/starikov.io`, and locally `GHOST_CONTENT_API_KEY=<key> node scripts/refresh-snapshots.mjs --ghost` (extend the script) to write + commit `ghost-snapshot.json`. Add `GHOST_CONTENT_API_KEY: ${{ secrets.GHOST_CONTENT_API_KEY }}` to deploy.yml build env.
- [ ] **Step 3: /writing page** — top note (*"Essays live at starikov.co — this is the index."*), year-grouped LedgerRows: title · 8px tag dot (Ghost `accentColor` as inline `--dot` var + tag name in `--text-secondary`) · reading time · date · ↗ (external, `rel="noopener"`); client-side tag filter chips (utilities script, `hidden` attr toggling — no layout thrash). Wire home + RelatedEssays.
- [ ] **Step 4: related.test.ts** (manual slugs resolve + preserve order; bogus slug warns; tag fallback fills to 3; none → []). Verify: build with key unset → snapshot warning, site complete. Commit — `feat: weave Ghost essays in — /writing index, related essays, home feed`

---

### Task 15: Build gates + validate-dist

**Files:**
- Create: `scripts/validate-dist.mjs`
- Modify: `package.json` (append `&& node scripts/validate-dist.mjs` to build), `src/lib/model.ts` (write `dist`-independent counts manifest `src/data/generated/counts.json` during build via content-config side module or loader summary)

**Interfaces:**
- Consumes: `SITE.minCounts`; collections' counts (loaders append to `counts.json` via `report.ts`).
- Produces: non-zero exit on gate failure; GitHub annotations; `$GITHUB_STEP_SUMMARY` table when in CI.

- [ ] **Step 1: Checks** (all against `dist/` + counts.json): per-tool HTML exists for every tool entry; `/writing/` contains ≥ `minCounts.essays` occurrences of `starikov.co/`; a `[data-theme="tokyonight-storm"]` rule reachable in emitted CSS (grep `dist/_astro/*.css` for the sentinel `--code-comment`); `sitemap-index.xml` + `pagefind/` (Pagefind check activated in Task 16 — feature-flag via existence of the integration in astro.config, else skip with note); 4 academia volume URLs HEAD → 200 (network — behind `BUILD_STRICT` so offline local builds don't fail: only enforced in CI); CNAME in dist; counts vs minCounts under `BUILD_STRICT=1`.
- [ ] **Step 2: Prove the gate.** Temporarily set `minCounts.essays: 99999` → `npm run build` (with `BUILD_STRICT=1`) exits 1 with `::error::essays: 94 < 99999`; revert. Commit — `feat: hard build gates — a half-empty site can never deploy`

---

### Task 16: Pagefind search

**Files:**
- Modify: `astro.config.mjs` (add `astro-pagefind` integration), `src/layouts/Shell.astro` (add `data-pagefind-body` to `<main>`, `data-pagefind-meta`/filters per page type), `scripts/validate-dist.mjs` (enable pagefind check)

- [ ] **Step 1:** `npm i astro-pagefind`; annotate layouts: `data-pagefind-filter="type:tool"` etc. from the page's `SiteItem.type`. Exclude chrome (`data-pagefind-ignore` on sidebar/rail).
- [ ] **Step 2:** Build → `dist/pagefind/pagefind.js` exists; `node -e` quick query for "pocketcasts" returns the tool page. Commit — `feat: Pagefind full-text search over all site content`

---

### Task 17: ⌘K command palette

**Files:**
- Create: `src/components/Palette.astro`, `src/scripts/palette.ts`, `src/pages/palette-index.json.ts`
- Modify: `Shell.astro` (mount + `open-palette` event), sidebar search button
- Test: `test/palette-fuzzy.test.ts`

**Interfaces:**
- Consumes: `getAllItems()` → `/palette-index.json` (SiteItems + essays with `↗` marker + theme commands from themes.json); `window.__setTheme`; Pagefind JS API at `/pagefind/pagefind.js`.
- Produces: `<command-palette>` custom element, ~4KB gz budget; keyboard: `⌘K`/`Ctrl+K`/`/` open, Esc close, `↑↓` via `aria-activedescendant`, Enter navigate, `⌘Enter` new tab. ARIA combobox pattern: input keeps focus, `role="listbox"` popup, live region announcing result count.

- [ ] **Step 1: Fuzzy scorer with tests** — `fuzzyScore(query, text): number` (subsequence match, word-boundary + start bonuses, contiguity bonus); tests: `'pcr'` matches `pocketcasts-reset` above `projects`; `'theme'` ranks `Theme: Catppuccin` and `/colophon` sensibly; non-matching → 0.
- [ ] **Step 2: Element.** Groups in order: Jump to → Essays (`↗`) → Theme → Actions (Copy URL, Open repo for current page, Go to colophon). Lazy: element defined on first keydown/click; index fetched on first open; typing ≥3 chars dynamically `import('/pagefind/pagefind.js')` and inlines top 5 under "Content". Filtering renders instantly (no animation). Panel open: overlay 120ms fade + panel scale .98→1 160ms.
- [ ] **Step 3: Verify** — keyboard-only session: open with `/`, find a tool, an essay (opens starikov.co in new tab), switch theme from palette, Esc restores focus to trigger. Screen-reader spot check (VoiceOver: combobox announced, count announced). Bundle check: `du -h dist/_astro/*palette*` ≤ 4KB gz target (`gzip -c | wc -c`). Commit — `feat: ⌘K command palette — nav, essays, themes, full-text search`

---

### Task 18: Colophon, about, changelog, RSS

**Files:**
- Create: `src/pages/{colophon,about,changelog}.astro`, `src/pages/rss.xml.ts`, `public/og-default.png`, `src/components/ThemeGallery.astro`

**Interfaces:**
- Consumes: full (uncurated) theme data — extend `build-themes.mjs` to also emit `src/data/generated/themes-all.json` (every family/variant with swatch hexes only; no CSS) for the gallery; `getAllItems()` for RSS/changelog.

- [ ] **Step 1: /colophon** per spec §5: pipeline diagram (styled HTML/SVG: `colors.json → templates → {8 terminal apps} → this site`), ThemeGallery (57 swatch strips grouped by family; the 16 curated get `role="button"` + `__setTheme`; rest labeled `terminal-only`), the a11y disclosure paragraph (how `--text-secondary`/`--code-comment` are derived and why — *"the web sibling of validate-themes.sh"*), type specimen, stack list, provenance line (`Palette synced from dotfiles@<sha> · built <timestamp>` — sha captured by build-themes.mjs into themes.json `meta`), link to site source.
- [ ] **Step 2: /about** (short bio, the profile-repo SVG card `<img>` light/dark via `<picture>` + `prefers-color-scheme`, resume PDF links, contact), **/changelog** (30 most recent SiteItems grouped by month, one-line entries), **rss.xml** via `@astrojs/rss` (same items; essay items link to starikov.co).
- [ ] **Step 3: OG default** — 1200×630 PNG rendered once from tokyonight-storm palette (generate with a throwaway node canvas script or design tool; commit the PNG); `<meta property="og:image">` in Base with per-page title/desc tags. Verify with a validator. Commit — `feat: colophon story page, about, changelog, site RSS, OG defaults`

---

### Task 19: Freshness automation + sibling dispatch

**Files:**
- Create: `.github/workflows/keepalive.yml`
- Create (in THIS repo, for handoff): `handoff/notify-site.yml`
- Modify: `deploy.yml` (actions/cache for `.cache` + `public/media` if not already; confirm all checkouts)

- [ ] **Step 1: keepalive.yml** — separate workflow, `schedule: [{cron: '0 8 * * 1'}]`, `permissions: {actions: write}`, single step `gautamkrishnar/keepalive-workflow@v2` with `use_api: true`. (Deploy job's permission set would 403 this call — that's why it's separate.)
- [ ] **Step 2: Dispatch senders.** `handoff/notify-site.yml` exactly per spec §7 (peter-evans/repository-dispatch@v3, `event-type: content-update`, secret `SITE_DISPATCH_TOKEN`). **USER ACTION (do not do unilaterally): create a fine-grained PAT scoped to starikov.io repo with contents:write named `SITE_DISPATCH_TOKEN`, add it as a secret to `bin` and `.dotfiles`, and commit `handoff/notify-site.yml` into each repo's `.github/workflows/`. Ask before pushing anything to sibling repos.**
- [ ] **Step 3: End-to-end freshness test** (after user action): whitespace commit to `bin` → site rebuild triggered within ~1 min (`gh run list -R IllyaStarikov/starikov.io -L 1`). Commit — `ci: keepalive + sibling-repo dispatch handoff`

---

### Task 20: Craft & compliance pass (award-submission gate)

**Files:**
- Modify: anything failing audit; rewrite repo `README.md` (describe the new site, architecture diagram, "themes generated from my dotfiles" story, dev quickstart)

- [ ] **Step 1: Motion audit** against spec §4 table — every listed interaction present, correct duration/easing; `prefers-reduced-motion` kills all of it (OS toggle test).
- [ ] **Step 2: Lighthouse CI sweep** — `/`, `/projects/dotfiles`, `/bin/pocketcasts-reset`, `/academia`, `/writing`: all four categories ≥95, target 100; fix regressions (font preload, image dimensions, contrast).
- [ ] **Step 3: Cross-device pass** — iOS Safari (academia thumbnails not iframes; nav sheet; palette on touch), 375px→1440px sweep, dark/light/system × 3 families spot grid.
- [ ] **Step 4: Budget check** — `gzip -c dist/_astro/*.css | wc -c` (themes ≤6KB slice), total JS ≤25KB gz, fonts ≤110KB; record numbers in README.
- [ ] **Step 5: Full a11y keyboard walk** + VoiceOver spot check; `validate-dist` green under BUILD_STRICT; final deploy; verify live at https://starikov.io.
- [ ] **Step 6: Commit** — `docs: new README for the rebuilt site` + tag `v1.0.0`.

---

## Self-Review (performed)

- **Spec coverage:** §3 routes → Tasks 9/10/12/13/14/18 (v1 rows all covered; v1.1 rows deliberately absent). §4 language → Tasks 4/7. §5 theme system → Tasks 3/5/6/13/18. §6 content architecture → Tasks 8–14. §7 build/deploy/resilience → Tasks 2/6/11/15/19. §8 search/palette → Tasks 16/17. §9 budgets → Tasks 4/17/20. §10 cut line respected (no eclecta RSS loader, no essay stubs, no per-page OG, no inline PDF readers, no `g x` chords). §11 extensibility → Tasks 9 (zero-step bin), 19 (dispatch). §12 verification → distributed per task + Task 20.
- **Placeholder scan:** clean — every step names exact files, commands, or complete logic; presentational tasks bind to the normative spec sections by reference.
- **Type consistency:** `SiteItem` defined Task 9, consumed 13/17/18; `withFallback` defined 11, consumed 14; `parseReadme` defined 8, consumed 9; `themes.json` shape defined 3, consumed 5/13/17/18; `__setTheme` defined 5, consumed 17/18.
- **Known user-action gates:** Task 2 (Pages source flip — done via gh), Task 14 Step 2 (Ghost key), Task 19 Step 2 (PAT + sibling-repo commits — requires explicit user approval).
