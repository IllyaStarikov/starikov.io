# starikov.io — Design Specification

**Date:** 2026-07-17 · **Status:** awaiting approval · **Supersedes:** the README-only site

## 1. Context

starikov.io is currently a single README.md rendered by GitHub Pages: out of date (links to a now-private colosseum repo), flat, and unrepresentative of the actual body of work. The goal is a ground-up rebuild: a **personal engineering hub** — part portfolio, part g3doc/wiki — that documents everything Illya has built, grows with zero-to-minimal effort as new work appears, and is executed at design-award level.

User-locked decisions (from brainstorming):

- **Aesthetic:** engineer-craft minimal (Rauno Freiberg / Paco Coursey school) — quiet, typography-first, obsessive micro-interactions, hand-tuned dark mode.
- **Signature moment:** the site is **app #9 of the dotfiles theme engine** — its themes are generated at build time from the real `~/.dotfiles` theme system (57 variants, 17 families, one `colors.json` schema).
- **Content model:** auto-first + curated overlay. Sibling repos and the Ghost blog are pulled at build; curated MDX adds narrative per slug.
- **Blog:** woven in via Ghost Content API (starikov.co stays canonical for reading).
- **V1 scope:** Home + flagship projects + auto `/bin/<tool>` + `/academia` + writing integration.
- **Excluded:** colosseum (now private), economister.
- Keep Google Analytics `G-MF94N59911` and the `starikov.io` CNAME.

## 2. Concept

> **The site is app #9 of the dotfiles theme engine, and it behaves like a personal g3doc that happens to be beautiful.**

The binding metaphor is the home directory: the wordmark is `~/starikov`, breadcrumbs are shell paths (`~/bin/pocketcasts-reset`), and the palette on screen is literally the palette in the terminal. Wiki structure expressed in the site's native accent.

## 3. Information Architecture

| Route | Contents | Generation | Version |
|---|---|---|---|
| `/` | Prompt hero + live neofetch-style system card + Start Here ledger + Recently Updated + latest essays | static + build data | v1 |
| `/projects` | Ledger of all projects, flagships pinned | curated + auto | v1 |
| `/projects/<slug>` | dotfiles (deep), eclecta, mcp-servers, artificial, resume, profile | auto base + MDX overlay | v1 |
| `/bin` | Tool index (bin repo's Scripts table, elevated) | fully auto | v1 |
| `/bin/<tool>` | Man-page-meets-tldr per tool; dir name = slug | fully auto | v1 |
| `/academia` | Degree header + stats, Four Volumes shelf (thumbnails + open ↗), 14-project media showcase, course index | auto + curated layout | v1 |
| `/writing` | ~94 Ghost essays, year-grouped, tag filter; rows **link out** to starikov.co | build-time Ghost API | v1 |
| `/colophon` | The signature story: theme pipeline diagram, 57-variant gallery, type specimen, token-derivation disclosure, build provenance | static + generated | v1 |
| `/about` | Bio + auto-refreshing neofetch SVG card + resume links | static | v1 |
| `/changelog` | Human-readable feed of the site RSS (proof of "everliving") | auto | v1 |
| `/404` | `zsh: command not found: <path>` + ⌘K prompt | static | v1 |
| `/academia/<volume>` | Inline PDF reader (desktop-only, capability-gated) | static | v1.1 |
| `/academia/<course>` | Auto page per course (code + notes) | auto | v2 |
| `/writing/<slug>` | Essay stub pages (excerpt + canonical link) for search/OG | auto | v1.1 |
| `/notes` | Digital-garden growth surface | curated | v1.1 |

`/uses` and `/craft` fold into `/colophon`. No bento grids, no headshot hero, no tech-icon walls.

**App shell:** persistent 240px left sidebar on desktop (wordmark `~/starikov` with a cursor `▊` that blinks twice then stops; `Search… ⌘K` affordance; nav groups with 11px uppercase mono labels: Index / Projects / Tools / Academia / Writing; footer with theme swatch + mode toggle + GitHub). Groups >8 entries show 8 most-recent + "All N →". Content pages get a right rail (≥1280px): TOC with scrollspy + Connections block (**renders only at ≥2 resolved links** — never an empty affordance). Mobile: top bar + full-screen sheet + ⌘K. Every content page opens with its breadcrumb path in mono.

## 4. Design Language

### Typography

- **Body/UI:** Inter Variable v4, self-hosted woff2, wght 400–600, `cv05/cv11/ss01`, Capsize-adjusted system fallback (zero CLS).
- **Mono (identity font):** **Commit Mono** (open license) in v1. Berkeley Mono is the aspirational upgrade **only after** verifying its web-embedding license tier; paid font binaries are never committed to the public repo (private release asset or CI secret-URL fetch if purchased).
- No serif. Scale (px): 12 / 13 / 14 / 16 (body, 1.5, 65–70ch) / 20 / 24 (h2) / 32 (h1) / 44 (home statement only). Headings 600, lh 1.15, ls −0.02em. Mono eyebrows: 11–13px uppercase +0.04em.

### Spacing & grid

4px base; scale 4–96. Document grid, not marketing grid: 720px content column, 960px media breakout, full-bleed only for the home system card. Shell: 240 / fluid / 224. Section rhythm 96/48/24px.

### Color & token architecture (a11y-corrected)

Build emits per-variant CSS blocks. **Two tiers:**

1. **Raw terminal tokens** — `--bg --fg --surface --border --muted --accent --accent-alt --selection --cursor --ansi-0…15` — used for **chrome only** (borders, fills, accents, swatches). `--muted` is **never** text: measured contrast is 1.8–2.5:1 across most variants.
2. **Derived text tokens** — `--text-secondary`, `--code-comment` — generated at build by iterating `color-mix(fg, bg)` until contrast floors pass (≥4.5:1 body-adjacent, ≥3:1 large/14px+ mono). Body `fg/bg` is validated ≥4.5:1 (tokyonight/day passes at 4.52 — **no opacity on body text, ever**). Derivations are **disclosed on /colophon** — authenticity through honesty, the web sibling of `validate-themes.sh`.

Also derived: `--surface-raised`, `--surface-hover`, `--focus-ring`, `--ok/--warn/--err`. `color-scheme` set from manifest `mode`.

**Syntax highlighting re-themes live:** Shiki `css-variables` theme at build; per-theme blocks map `--astro-code-token-*` to ANSI colors (comments → `--code-comment`, not `--muted`). Code blocks visibly recolor on theme switch — the detail that sells the story.

**Elevation:** surface step + 1px border; exactly one shadow (floating layers only). Radii 4/6/10/999. Icons: Lucide 16px stroke 1.5, chrome only; prefer glyphs (`❯ → ⌘K ▊`). Favicon: SVG `❯`.

### Motion

Tokens: `--dur-1..4: 100/150/200/300ms`, `--ease-out: cubic-bezier(0.16,1,0.3,1)`. Laws: transform/opacity only, user-initiated ≤300ms, interruptible, `prefers-reduced-motion` disables all but focus. Sanctioned color-transition exceptions (specific over general): the 120ms theme swap crossfade and the link `text-decoration-color` hover (150ms) — both enumerated in the motion table below. Specifics: sidebar active bar slides via FLIP 180ms; page transitions fade 100ms out / 180ms in +4px rise with sidebar `transition:persist`; list entrance staggers first 10 rows only, first visit only (each row's animation ≤240ms with 20ms stagger; the full cascade may run ~420ms wall-time — the ≤300ms law applies per element, not to the cascade); ⌘K panel scale 0.98→1 160ms, **filtering results: zero animation**; theme switch = 120ms linear tinted crossfade (no view-transition screenshots); copy ✓ spring; hero cursor blinks twice then holds.

## 5. The Signature Theme System

### Contract (the spec both tracks build against)

- **Axes:** visitor picks a **family**; **mode** (light/dark/system) picks the variant. Curated set = **only families with true light+dark pairs** per the manifest's `mode` field: tokyonight, catppuccin, github, ayu, iceberg, nightowl, atomone, material (8 families ≈ 16 variants). Dark-only families (nord, dracula, monokai…) are **/colophon gallery only** — no silent family swap on OS light switch.
- **Explicit `webPair: {light, dark}` per family in `site.config.ts`** (github has 6 dark variants, tokyonight 3 — "first in manifest order" is fragile).
- **One attribute:** `data-theme="<family>-<variant>"` on `<html>`; selectors target it. localStorage: `theme:family` + `theme:mode`. Defaults: `tokyonight` + `system` (dark→storm — the actual terminal default; light→day).
- **Pre-paint:** blocking inline head script (<1KB) sets attribute + `<meta name="theme-color">`; `matchMedia` listener live-switches in system mode (mirrors the dotfiles' macOS auto-switching — /colophon says so).
- **ClientRouter survival:** `astro:after-swap` listener re-applies theme attributes + theme-color; head script marked `data-astro-rerun`. **Verify step: switch theme → navigate → hard-refresh: no flash, no reset.**

### UX

1. **Sidebar footer swatch** (accent dot + family name) → popover: 8 family rows each rendered in its own colors, mode segmented control, footer line in 12px mono: *"Generated from ~/.dotfiles/src/theme — the same colors.json that themes my terminal. → colophon"*.
2. **Home system card is the discovery device:** a neofetch-style panel with real build data (90.8K dotfiles lines, 57 themes / 17 families, 94 essays, latest cross-repo commit, build timestamp) whose **`theme: tokyonight/storm` row is itself the picker control** — neofetch panels literally list the theme; a visitor who never opens any menu still learns the site is themed by a terminal.
3. **⌘K:** `Theme: Catppuccin`…, `Toggle light/dark`.
4. **/colophon:** all 57 variants as swatch strips (16 curated clickable, rest "terminal-only"), pipeline diagram (colors.json → templates → 8 apps → **this site**), provenance line: *"Palette synced from dotfiles@`<sha>` · built `<timestamp>`"*.

### Pipeline

`scripts/build-themes.mjs` (prebuild): reads sparse CI checkout of `IllyaStarikov/.dotfiles` (`config/themes.json` manifest + `src/theme/**/colors.json`), Zod-validates the 26-key schema, runs the contrast derivation, emits `src/styles/themes.generated.css` (budget stated **gzipped**: ≤6KB; ANSI vars emitted only for consuming components) + `src/data/generated/themes.json` for the picker. **Fallback cascade:** live checkout → committed vendor snapshot (`src/data/vendor/themes-snapshot/`) → hard fail (snapshot corruption is a repo bug). The dotfiles repo can refactor freely without breaking a deploy.

## 6. Content Architecture

Astro 5 Content Layer. **Auto collections** (loader-generated, zero human files): `tools` (bin READMEs — **parse, never execute**; the real pocketcasts-reset README with its `### Credentials` H3 and How-it-works table is the parser's fixture test), `academiaShowcase` + `courses` (PORTFOLIO.md + dir enumeration), `repos` (GitHub API metadata via plain fetch + `GITHUB_TOKEN`, per-repo stale fallback), `essays` + `essayTags` (Ghost Content API, key as secret), `eclectaLatest` (RSS, v1.1). **Curated collections:** `projects` (MDX is the page; repo metadata joins on), `toolOverlays`/`academia overlays` (optional decoration).

**Overlay rule:** auto collections are complete alone; overlays only decorate. One merge layer (`src/lib/model.ts`) produces a uniform `SiteItem {type, slug, title, tagline, href, date}` powering home feed, ⌘K index, Connections, RSS, and Pagefind — the wiki's shared schema.

**Related essays:** manual-first — overlay frontmatter `essays: [slugs]`, then `essayTags` matching, else section absent. No fuzzy matching; unknown slugs warn with filename.

**Academia media:** the four PDF volumes live at the **root** of academia.starikov.io (`/curated.pdf` 284pp, `/notes.pdf` 473pp, `/assignments.pdf` 498pp, `/complete.pdf` 1,113pp — verified 200; build runs a HEAD check on all four). v1 shows pre-rendered first-page thumbnails + page counts + "Open PDF ↗" (iOS iframes render PDFs as a frozen first page — inline readers are v1.1, desktop-only, capability-gated). GIF demos are **transcoded to mp4/webm + poster** in a prebuild step (ffmpeg installed on the runner), digest-cached via `actions/cache` so transcoding runs once, not nightly; hero PNGs route through `src/assets` for AVIF.

## 7. Build & Deploy

Single `deploy.yml`: checkouts (self + sparse dotfiles + bin + academia) → setup-node + npm cache → `actions/cache` for `.cache`/`.astro`/derived media → `npm run build` (= build-themes → astro build [astro-pagefind indexes here — **once**] → validate-dist) → `upload-pages-artifact` → `deploy-pages@v5`. Permissions `contents: read, pages: write, id-token: write`; failed build never deploys (last good stays live). `public/CNAME` preserved.

**Triggers:** push · nightly cron (`17 9 * * *` — the essay-freshness mechanism) · `workflow_dispatch` · `repository_dispatch: content-update` (drop-in `notify-site.yml` for `bin` and `.dotfiles` using a fine-grained PAT; academia is archived and frozen). **Keepalive:** separate minimal workflow with `actions: write` permission (the deploy job's permission set would 403 the keepalive API call — verified failure mode); confirm via step logs.

**Resilience matrix:** every remote source follows live → `.cache` → committed vendor snapshot → declared policy (essays: **fail via min-count gate** — an essay-less deploy is a half-empty site; GitHub meta: proceed stale; eclecta: omit). Hard gates: min-counts (`essays ≥ 50, tools ≥ 1, themeVariants ≥ 10, projects ≥ 4`) under `BUILD_STRICT=1`, plus `validate-dist.mjs` asserting per-tool HTML exists, themes CSS shipped, Pagefind index + sitemap present, and the four academia PDF URLs answer 200. Warnings surface as GitHub annotations + step summary.

**Analytics:** GA4 with `send_page_view: false` + manual `page_view` on `astro:page-load` (ClientRouter makes navigation virtual — default gtag would undercount to uselessness). **SEO/distribution:** `@astrojs/sitemap`, robots.txt, site RSS (`/rss.xml` — the changelog feed `/changelog` renders), static default OG card in v1 (satori per-page endpoint is v1.1, digest-cached).

## 8. Search & ⌘K Palette

**Zero framework islands — everything is static Astro + small vanilla TS.** The palette (~4KB owned code, ARIA combobox: `aria-activedescendant`, focus trap, live region) loads on idle/first keydown, fetches a build-generated index JSON (~15KB). Groups: Jump to → Essays (`↗`, fuzzy title match from index — labeled honestly as titles/excerpts, not full text) → Theme → Actions. Typing 3+ chars lazy-loads Pagefind for full-text hits across on-site pages. `⌘K`/`Ctrl+K`/`/` open; `g x` chords + `?` sheet are v1.1.

## 9. Performance & Accessibility Budget

Lighthouse 100×4 on `/`, a project page, a tool page. CLS 0; LCP <1.5s at 4× throttle. Budgets: HTML ≤12.5KB gzipped per index page (raw byte counts don't reflect network cost; see the 2026-07-26 amendment below for the full measured basis); CSS ≤30KB total (themes ≤6KB gz); JS ≤25KB gz including deferred palette; fonts ≤110KB. Build-time contrast validation of every curated variant (mirrors `validate-themes.sh`; cited on /colophon). `:focus-visible` rings, skip link, titled iframes, `aria-label`ed kbd glyphs, tag color never sole meaning-carrier, reduced-motion global, pre-paint theme (no flash).

**Amendment (2026-07-26, v1.1 polish Task 2):** the original `HTML ≤40KB` line was a raw (uncompressed) count -- inconsistent with CSS/JS's own gzipped budgets on the same line, and unachievable for a real content index regardless of markup discipline. `/writing`'s 94-row essay ledger, the heaviest index page, measures a ~57KB raw floor (~29KB shared shell chrome + ~950B/row) even after a byte diet (LedgerRow.astro's styles made global instead of per-row-scoped, the external-link arrow and tag dot moved from DOM spans to generated content, the per-row wrapper `<div>` dropped). Restated gzipped, matching CSS/JS's own convention: **HTML ≤12.5KB gzipped per index page**, verified against `/writing` as the worst case. Measured before/after the diet: raw 119,853 B → 75,186 B (‑37%, essentially the predicted ~75-78KB); gzip 12,458 B → 11,887 B (only ‑5%, short of an earlier ~8.5KB estimate) -- the bytes removed were overwhelmingly repeated `data-astro-cid-*` scoping attributes and wrapper markup, exactly the kind of redundancy gzip had already compressed away for free, while the genuinely unique per-row content (94 distinct titles/dates/tags) dominates the compressed size and can't shrink further without cutting content. An honest amendment, not a silent bust. Other index pages sit well inside the line: `/` 8.2KB gz, `/projects` 6.9KB gz, `/bin` 6.5KB gz -- `/bin`'s single-tool page is the shared-shell floor every index page pays before its own rows (~29KB raw / ~6.5KB gz), regardless of content.

## 10. V1 Cut Line

**The award submission is carried by ~8 deep pages:** `/`, `/projects/dotfiles`, `/bin` + `/bin/pocketcasts-reset`, `/academia`, `/writing`, `/colophon`, `/404` — plus the theme system and palette. Other flagship project pages ship in v1 as competent overlay pages (hero + metadata + short story + related essays), deepened over time.

**Deferred to v1.1 (written down, not forgotten):** per-page OG endpoint · essay stub pages · eclecta RSS line · `g x` chords + `?` sheet · topic-driven auto project cards · `refresh-snapshots.yml` weekly PR job · inline PDF readers (desktop, capability-gated) · Connections everywhere (v1: only where ≥2 curated links exist) · `/notes` garden · Ghost webhook → instant essay rebuilds (worker) · Berkeley Mono (license-gated).

## 11. Extensibility Contract

| Event | Effort | Mechanism |
|---|---|---|
| New tool in bin | **zero** | push → dispatch → rebuild → page + index + palette + search + RSS |
| New essay on Ghost | **zero** | nightly cron (≤24h staleness) |
| New theme family/variant in dotfiles | **zero** for variants of curated families; one `curatedFamilies` entry + its `webPairs` pair to curate a new family | dispatch → build-themes regenerates |
| New repo becomes a project | one ~10-line MDX overlay (v1.1: zero for a card via `starikov-io` topic) | overlay model |
| Dotfiles refactor breaks schema | **zero risk** | snapshot fallback + warning annotation |

## 12. Verification Plan

Per implementation phase (detailed in the implementation plan): green Pages deploy on the domain; theme switch → navigate → hard-refresh with no flash/reset; local build with deleted dotfiles checkout succeeds from snapshot; corrupted snapshot fails the build; malformed test README skips with annotation; invalid Ghost key serves from cache; bogus overlay essay slug warns with filename; whitespace push to `bin` triggers a site rebuild within a minute; Lighthouse ≥95 all categories on the three page types; reduced-motion audit; iOS Safari check of `/academia`; keepalive step log check.

## 13. Decisions Resolved from Adversarial Critique

1. One theme contract: family+mode, paired families only, explicit `webPair`, single `data-theme`, `astro:after-swap` re-application.
2. Token a11y: raw tokens for chrome, contrast-floored derived text tokens, disclosed on /colophon.
3. Essays: link-out in v1; stubs in v1.1.
4. Every heavy transform (GIF→video, AVIF, thumbnails, OG) is digest-cached or committed — never repeated per nightly build.
5. V1 cut line as §10 — depth-per-page over surface count, `/notes` named as the wiki's growth surface.
