import { describe, expect, it } from 'vitest';
import { systemStatsProvenanceLine } from '../src/lib/system-stats';

describe('systemStatsProvenanceLine', () => {
  it('reports "computed fresh at build" when source is "git" (a real checkout was counted this build)', () => {
    const line = systemStatsProvenanceLine({ source: 'git', measured: null });
    expect(line).toBe(
      'Every other System card number (plugin count, dotfiles lines/files, theme variant/family counts) is computed fresh at build, same as the palette above.',
    );
  });

  it('reports the same "fresh at build" wording for source "fs" (a local checkout with no .git)', () => {
    expect(systemStatsProvenanceLine({ source: 'fs', measured: null })).toBe(
      systemStatsProvenanceLine({ source: 'git', measured: null }),
    );
  });

  it('names the dated committed snapshot when source is "snapshot" and a measured date is known', () => {
    const line = systemStatsProvenanceLine({ source: 'snapshot', measured: '2026-07-26' });
    expect(line).toContain('the committed snapshot (measured 2026-07-26), not this build');
    expect(line).toContain('Theme variant/family counts are still computed fresh at build');
    // Must NOT claim plugin/dotfiles numbers are fresh -- that's the exact lie this fixes.
    expect(line).not.toContain('plugin count, dotfiles lines/files, theme variant/family counts) is computed fresh');
  });

  it('falls back to undated wording (never a fabricated date) when source is "snapshot" but no measured date is known', () => {
    const line = systemStatsProvenanceLine({ source: 'snapshot' });
    expect(line).toContain('a last-resort default, not the committed snapshot or this build');
    expect(line).not.toMatch(/measured \d{4}-\d{2}-\d{2}/);
  });

  it('treats an unrecognized source value the same as "snapshot" -- the cautious wording is the safe default', () => {
    // Defensive: a value this function doesn't recognize must never be read
    // as "fresh" (the codebase's own convention is to fail honest, not fail
    // optimistic -- see e.g. src/lib/projects.ts omitting stars when stale).
    const line = systemStatsProvenanceLine({ source: 'bogus', measured: '2026-01-01' });
    expect(line).toContain('the committed snapshot (measured 2026-01-01), not this build');
  });
});
