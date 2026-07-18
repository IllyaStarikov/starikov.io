import { describe, expect, it } from 'vitest';
import { contrastRatio, deriveTextTokens, deriveToFloor, relLuminance } from '../scripts/lib/contrast.mjs';

describe('relLuminance', () => {
  it('white is 1, black is 0', () => {
    expect(relLuminance('#ffffff')).toBeCloseTo(1, 4);
    expect(relLuminance('#000000')).toBeCloseTo(0, 4);
  });
});

describe('contrastRatio', () => {
  it('white vs black is 21:1', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 2);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#c0caf5', '#24283b')).toBeCloseTo(contrastRatio('#24283b', '#c0caf5'), 6);
  });

  it('tokyonight storm fg/bg meets AA text contrast (>= 4.5)', () => {
    expect(contrastRatio('#c0caf5', '#24283b')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('deriveToFloor', () => {
  it('returns a color that still meets the floor against bg', () => {
    const c = deriveToFloor('#c0caf5', '#24283b', 4.5);
    expect(contrastRatio(c, '#24283b')).toBeGreaterThanOrEqual(4.5);
  });

  it('falls back to fg when even t=0 cannot be improved upon (already best)', () => {
    // fg itself already satisfies floor by a huge margin; mixing toward bg should
    // still return *some* color meeting the floor (not undefined/null).
    const c = deriveToFloor('#ffffff', '#000000', 4.5);
    expect(c).toBeTruthy();
    expect(contrastRatio(c, '#000000')).toBeGreaterThanOrEqual(4.5);
  });

  it('a pathological low-contrast pair still returns something >= floor or falls back to fg', () => {
    // fg and bg are nearly identical -- no amount of mixing toward bg can hit a high floor.
    const fg = '#808080';
    const bg = '#7f7f7f';
    const floor = 4.5;
    const c = deriveToFloor(fg, bg, floor);
    // Either it meets the floor, or (since even t=0 doesn't satisfy it) it falls back to fg.
    const ratio = contrastRatio(c, bg);
    expect(ratio >= floor || c === fg).toBe(true);
  });
});

describe('deriveTextTokens', () => {
  it('tokyonight storm: outputs meet their floors', () => {
    const { textSecondary, codeComment } = deriveTextTokens('#c0caf5', '#24283b');
    expect(contrastRatio(textSecondary, '#24283b')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(codeComment, '#24283b')).toBeGreaterThanOrEqual(3.0);
  });

  it('tokyonight day: outputs meet their floors', () => {
    const { textSecondary, codeComment } = deriveTextTokens('#3760bf', '#e1e2e7');
    expect(contrastRatio(textSecondary, '#e1e2e7')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(codeComment, '#e1e2e7')).toBeGreaterThanOrEqual(3.0);
  });

  it('pathological low-contrast pair: returns something meeting the floor, or falls back to fg', () => {
    const fg = '#808080';
    const bg = '#7f7f7f';
    const { textSecondary, codeComment } = deriveTextTokens(fg, bg);
    const secRatio = contrastRatio(textSecondary, bg);
    const commentRatio = contrastRatio(codeComment, bg);
    expect(secRatio >= 4.5 || textSecondary === fg).toBe(true);
    expect(commentRatio >= 3.0 || codeComment === fg).toBe(true);
  });
});
