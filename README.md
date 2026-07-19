# starikov.io

The source for [starikov.io](https://starikov.io) — a personal site built as a
workshop, not a résumé. It is a wiki over ten years of work: dotfiles,
command-line tools, university coursework, and essays, each pulled from its own
live source at build time and cross-linked into one browsable index. Nothing on
the site is hand-transcribed from those sources; the pages *are* the sources,
parsed.

The whole thing is static — Astro 5 output, zero framework islands, a few
kilobytes of vanilla TypeScript for the command palette and the app shell — and
it deploys itself to GitHub Pages on every push and once a night.

## The signature: themed by the same terminal it describes

The palette is not chosen; it is *generated*. A prebuild step reads the theme
engine out of a sparse checkout of [`IllyaStarikov/.dotfiles`](https://github.com/IllyaStarikov/.dotfiles)
— the `config/themes.json` manifest plus every `src/theme/**/colors.json` — the
exact files that color Alacritty, tmux, Neovim, and Starship. It Zod-validates
the 26-key schema, derives the text tokens by iterating `color-mix(fg, bg)`
until each one clears its WCAG contrast floor, and emits per-variant CSS blocks.
Switching theme on the site recolors syntax highlighting live, because the
`--astro-code-token-*` variables map to the same ANSI colors. When the dotfiles
repo adds a variant, the site grows one — no edit here. The derivations are
disclosed on [`/colophon`](https://starikov.io/colophon): authenticity through
honesty, the web sibling of the repo's own `validate-themes.sh`.

## Architecture

Astro 5's Content Layer, split two ways:

- **Auto collections** (loader-generated, zero human files) — `tools` (bin
  READMEs, *parsed, never executed*), `academiaShowcase` + `courses` (a
  `PORTFOLIO.md` and directory enumeration), `repos` (GitHub API metadata),
  `essays` + `essayTags` (the Ghost Content API).
- **Curated collections** — `projects`, where a ~10-line MDX overlay is the page
  and the auto repo metadata joins onto it.

One merge layer (`src/lib/model.ts`) flattens everything into a uniform
`SiteItem { type, slug, title, tagline, href, date }` that powers the home feed,
the ⌘K index, cross-page Connections, the RSS feed, and the Pagefind search
index — the wiki's shared schema, defined once.

### Resilience cascade

Every remote source degrades along the same path, so a flaky upstream never
breaks a deploy:

```
live fetch  →  .cache (last good)  →  committed vendor snapshot  →  policy
```

The declared policy differs by source: essays **fail the build** via a
min-count gate (an essay-less site is a half-empty site); GitHub metadata
proceeds stale; the theme engine falls back to a vendored snapshot so the
dotfiles repo can refactor freely. Every fallback surfaces as a GitHub
annotation and a step-summary line.

### Build gates

`npm run build` runs `build-themes → transcode-media → astro build` (Pagefind
indexes in the same pass) `→ validate-dist`. Under `BUILD_STRICT=1` the build
also asserts hard min-counts (`essays ≥ 50, tools ≥ 1, themeVariants ≥ 10,
projects ≥ 4`), and `validate-dist.mjs` checks that every tool rendered an HTML
page, the theme CSS shipped, the Pagefind index and sitemap exist, and all four
academia PDF volumes answer `200`. A failed build never deploys — the last good
deploy stays live.

## Extensibility contract

The point of the architecture is that routine growth costs nothing:

| Event | Effort | Mechanism |
|---|---|---|
| New tool in the `bin` repo | **zero** | push → repository dispatch → rebuild → page + index + palette + search + RSS |
| New essay on Ghost | **zero** | nightly cron, ≤24h staleness |
| New variant of a curated theme family | **zero** | dispatch → `build-themes` regenerates the CSS + picker |
| New theme *family* to curate | **one array entry** | add it to `curatedFamilies` in `site.config.mjs` |
| A repo becomes a project | **one ~10-line MDX overlay** | the overlay model |
| Dotfiles refactor breaks the schema | **zero risk** | snapshot fallback + warning annotation |

## Development

The site parses sibling repos at build time. `sync-sources.sh` populates
`.sources/` from local checkouts (fast iteration) or shallow clones — it copies
files only and strips `.git`; no code from those repos ever runs.

```sh
scripts/sync-sources.sh   # .sources/{dotfiles,bin,academia}
npm install
npm run dev               # http://localhost:4321
```

Other tasks:

```sh
npm run build                 # full static build + gates
BUILD_STRICT=1 npm run build  # + hard min-count gates (what CI runs)
npm test                      # vitest — loaders, parsers, contrast, gates
npx astro check               # types
```

Ghost essays need `GHOST_CONTENT_API_KEY`; without it the build serves the
committed 94-essay snapshot. GitHub metadata uses `GITHUB_TOKEN` when present and
falls back to a vendored snapshot otherwise.

## Performance & accessibility budget

Lighthouse (desktop preset) and per-page transfer sizes, measured against the
production build. Sizes are gzipped over the wire, except fonts (already
compressed).

| Metric | Budget | Measured |
|---|---|---|
| Lighthouse (perf / a11y / best-practices / SEO) | 100 × 4 | **100 / 100 / 100 / 100** on `/`, `/bin/*`, `/academia`, `/writing`; a11y **96** on `/projects/dotfiles`¹ |
| CLS | 0 | **0** everywhere |
| LCP (4× CPU throttle) | < 1.5s | **0.4–0.5s** |
| CSS on `/` (total / theme engine) | ≤ 30KB / ≤ 6KB | **9.3KB / 3.6KB** |
| JS on `/` (incl. deferred palette) | ≤ 25KB | **13.3KB** |
| HTML on `/` | ≤ 40KB | **8.2KB** (44.6KB uncompressed) |
| Fonts | ≤ 110KB | **~142KB**² |

¹ The syntax-highlight comment token is derived to a 3:1 floor (AA for 14px+
mono, by design); Lighthouse scores it against its stricter 4.5:1 body-text
threshold.

² Commit Mono ships both 400 and 700 weights, and the bold wordmark loads the
700 file. Dropping it for synthetic bold reclaims the headroom — tracked for a
follow-up.

## Credits

Type: [Inter](https://rsms.me/inter/) and [Commit Mono](https://commitmono.com/).
Framework: [Astro](https://astro.build). Search: [Pagefind](https://pagefind.app).
Themes: my own [dotfiles](https://github.com/IllyaStarikov/.dotfiles) engine.

The build tooling here is a personal project — read it, borrow from it. The
prose, essays, and coursework are © Illya Starikov. Questions:
[illya@starikov.co](mailto:illya@starikov.co).
