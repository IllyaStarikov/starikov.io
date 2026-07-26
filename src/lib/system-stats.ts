/*
 * system-stats -- pure logic for /colophon's Provenance section (v1.1 polish
 * Task 6 fix round 1, Finding 2). scripts/build-system-stats.mjs's own
 * cascade (a real git checkout -> a filesystem walk -> the committed
 * src/data/vendor/system-stats-snapshot.json -> a hardcoded last resort)
 * means the System card's plugin-count / dotfiles-lines / dotfiles-files
 * numbers are NOT always "computed fresh at build" -- colophon.astro's claim
 * to that effect has to vary by which tier this build actually landed on, or
 * a fallback build makes the honesty page lie. Same "Astro-free, unit-
 * testable pure core" split as essayFreshnessLine (src/lib/essays.ts).
 */

export interface SystemStatsProvenanceInput {
  /** src/data/generated/system-stats.json's own `source` field: 'git' or
   *  'fs' mean a real dotfiles checkout was counted THIS build; anything
   *  else (in practice only 'snapshot') means every live tier failed and a
   *  committed/hardcoded fallback was used instead. Typed `string`, not a
   *  'git'|'fs'|'snapshot' union: this value comes from a JSON import, and
   *  TypeScript widens a JSON module's string fields to `string` (verified
   *  empirically -- it does NOT preserve the literal), so a narrower
   *  parameter type would just push an `as` cast onto the one call site
   *  instead of buying any real safety. Anything unrecognized is treated
   *  the same as 'snapshot' -- the cautious, non-"fresh" wording is the
   *  safe default for a value this function doesn't recognize. */
  source: string;
  /** system-stats.json's `measured` field: the committed snapshot's own
   *  dated provenance, present only when the 'snapshot' tier actually read
   *  that file. `null` for the git/fs tiers (not applicable) AND for the
   *  double-failure hardcoded-last-resort tier (no file was read, so there
   *  is no honest date to cite) -- both collapse to the same undated
   *  fallback wording below rather than fabricating a plausible-looking
   *  date. `undefined` is accepted too, purely so a caller (e.g. a test)
   *  can omit the field entirely rather than pass an explicit `null`. */
  measured?: string | null;
}

/**
 * /colophon's Provenance section, second sentence: names which System card
 * numbers are fresh THIS build vs which came from a fallback -- so the
 * honesty page never asserts freshness the build doesn't actually have.
 * Theme variant/family counts are always described as fresh regardless of
 * `source`: build-themes.mjs is a SEPARATE pipeline with its own already-
 * disclosed source provenance (the `sourceLabel`/`built` line directly above
 * this one in colophon.astro), so its currency doesn't depend on
 * build-system-stats.mjs's cascade at all. PURE.
 */
export function systemStatsProvenanceLine({ source, measured }: SystemStatsProvenanceInput): string {
  if (source === 'git' || source === 'fs') {
    return 'Every other System card number (plugin count, dotfiles lines/files, theme variant/family counts) is computed fresh at build, same as the palette above.';
  }
  const origin = measured
    ? `the committed snapshot (measured ${measured}), not this build`
    : 'a last-resort default, not the committed snapshot or this build';
  return `Plugin count and dotfiles lines/files come from ${origin} — no live dotfiles checkout was available. Theme variant/family counts are still computed fresh at build, same as the palette above.`;
}
