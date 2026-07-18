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
};
