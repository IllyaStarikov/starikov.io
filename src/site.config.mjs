// Plain-JS site knobs, importable from both Node scripts (scripts/build-themes.mjs,
// run under plain `node`, no TS loader) and from Astro/TypeScript via site.config.ts,
// which re-exports this object typed with `as const`. Keep this file the single
// source of truth for anything a build script needs; site.config.ts should only add
// types on top, never redefine values.
//
// curatedFamilies / webPairs were verified against the real manifest at
// .sources/dotfiles/config/themes.json (mirrors ~/.dotfiles/config/themes.json) --
// every family below has a true light+dark pair and every referenced variant id
// exists with the expected `mode`. See task-3-report.md for the verification notes.
/** @type {const} */
export const SITE = {
  title: 'starikov.io',
  description: 'Illya Starikov — software engineer. The workshop.',
  origin: 'https://starikov.io',
  gaId: 'G-MF94N59911',
  curatedFamilies: [
    'tokyonight',
    'catppuccin',
    'github',
    'ayu',
    'iceberg',
    'nightowl',
    'atomone',
    'material',
  ],
  webPairs: {
    tokyonight: { light: 'day', dark: 'storm' },
    catppuccin: { light: 'latte', dark: 'mocha' },
    github: { light: 'light_default', dark: 'dark_default' },
    ayu: { light: 'light', dark: 'dark' },
    iceberg: { light: 'light', dark: 'dark' },
    nightowl: { light: 'light', dark: 'dark' },
    atomone: { light: 'light', dark: 'dark' },
    material: { light: 'lighter', dark: 'darker' },
  },
  minCounts: { essays: 50, tools: 1, themeVariants: 10, projects: 4 },
  // The `repos` collection's (Task 11) repo list: every "owner/name" the
  // GitHub metadata loader fetches. Task 12's `projects` collection doesn't
  // exist yet, so this is read directly for now. Once it lands, the loader
  // MAY instead union this list with each project entry's `repo`/`repos`
  // frontmatter (so a curated project can reference a repo without a manual
  // edit here) -- Task 12's frontmatter values must then match these names
  // exactly (case as GitHub reports it, e.g. `IllyaStarikov/bin`).
  projectRepos: [
    'IllyaStarikov/.dotfiles',
    'IllyaStarikov/eclecta',
    'IllyaStarikov/omnifocus-mcp',
    'IllyaStarikov/readwise-mcp',
    'IllyaStarikov/artificial',
    'illyaStarikov/resume',
    'IllyaStarikov/IllyaStarikov',
    'IllyaStarikov/bin',
    'IllyaStarikov/academia',
  ],
};

// ---------------------------------------------------------------------------
// Editor cold-start (SystemCard's `editor` row) — v1.1 polish Task 6, A10/A11
// ---------------------------------------------------------------------------

// Neovim's own startup time isn't something a GitHub Pages build can measure
// (there's no neovim in the CI runner, and even if there were, "cold start on
// an M1" is a claim about THIS machine, not the build box) -- so unlike
// pluginCount/dotfilesFiles/dotfilesLines (build-system-stats.mjs, computed
// fresh every build), this is disclosed curated data instead: a real number,
// dated to when it was actually verified, not silently re-asserted forever.
// `label` is the dotfiles README's own long-standing claim ("~150ms" — see
// .dotfiles/README.md's "Neovim startup" row); `measured` is a LOCAL
// three-run `nvim --headless --startuptime` sample taken directly against
// ~/.dotfiles for this task (104ms / 114ms / 107ms -- comfortably under the
// label, so it stands as an honest, if rounded, upper bound). SystemCard
// prints `label`; /colophon's provenance section prints the disclosure line
// naming `measured`.
export const EDITOR_STARTUP = { label: '~150ms', measured: '2026-07-26' };

// ---------------------------------------------------------------------------
// Academia (/academia) — Task 10
// ---------------------------------------------------------------------------

// The four bound LaTeX volumes. Page counts and slugs are FROZEN (the academia
// repo is archived). The PDFs live at the ROOT of academia.starikov.io
// (/curated.pdf, /notes.pdf, …) — NEVER under /latex/. All four were verified
// HTTP 200 (`application/pdf`) via `curl -sI` before committing (see
// task-10-report.md). Blurbs come from PORTFOLIO.md's `## Documents` table; the
// loader cross-checks the parsed page counts against these and warns on drift.
export const ACADEMIA_PDF_ORIGIN = 'https://academia.starikov.io';

// (No `@type {const}` here: it isn't valid JSDoc — `const` is not a type, so it
// would erase these to `any` for TS consumers that `.map()` over them. Plain
// literal inference gives the right element types.)
export const PDF_VOLUMES = [
  { slug: 'curated', title: 'Curated', pages: 284, blurb: 'A selection of the best work.' },
  { slug: 'notes', title: 'Notes', pages: 473, blurb: 'Lecture notes and study materials.' },
  {
    slug: 'assignments',
    title: 'Assignments',
    pages: 498,
    blurb: 'Homework assignments with solutions.',
  },
  { slug: 'complete', title: 'Complete', pages: 1113, blurb: 'Everything: assignments and notes.' },
];

// Theme grouping for the Selected Projects showcase. DATA, not code, so the
// buckets stay tunable without touching the loader. Rules are evaluated in
// order, first match wins; a project matches a rule if its department code
// (from the course slug, e.g. `cs5400`) is in `depts` OR any `keyword` is a
// substring of its lowercased title. Anything unmatched falls to `systems`.
// Resulting buckets (documented in task-10-report.md):
//   ai       — Chess AI, Shape Packer, Puzzle Solvers          (cs5400/cs5401)
//   graphics — Linear Algebra, Lexical Analyzer, Graph Analytics
//   games    — Splatoonio, Space Invaders
//   systems  — Knapsack, CFG Tracer, Bolt, CLC Tally, Grading Suite, Camelot
export const ACADEMIA_THEME_RULES = [
  { theme: 'ai', depts: ['cs5400', 'cs5401', 'cs5402'], keywords: [] },
  { theme: 'games', depts: ['cs4096'], keywords: ['invaders', 'game', 'splatoon'] },
  {
    theme: 'graphics',
    depts: ['cs5201'],
    keywords: ['linear algebra', 'lexical', 'graph analytics', 'automat'],
  },
];

/** Theme assigned when no rule matches. */
export const ACADEMIA_THEME_FALLBACK = 'systems';

/** Render order + display labels for the theme sections (design §3). */
export const ACADEMIA_THEME_ORDER = [
  { theme: 'ai', label: 'Artificial intelligence' },
  { theme: 'graphics', label: 'Graphics & numerics' },
  { theme: 'games', label: 'Games' },
  { theme: 'systems', label: 'Systems & tooling' },
];
