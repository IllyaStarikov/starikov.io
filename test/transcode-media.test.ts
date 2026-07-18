import { describe, expect, it } from 'vitest';
import { needsTranscode } from '../scripts/transcode-media.mjs';

// The transcode script itself shells out to ffmpeg; only its PURE cache
// decision is unit-tested here (the brief forbids invoking ffmpeg in tests).
describe('needsTranscode (digest-skip decision)', () => {
  it('skips when the hash is unchanged and outputs already exist', () => {
    expect(needsTranscode('abc', 'abc', true)).toBe(false);
  });

  it('re-runs when the source hash changed', () => {
    expect(needsTranscode('abc', 'def', true)).toBe(true);
  });

  it('re-runs when an output is missing, even if the hash matches', () => {
    expect(needsTranscode('abc', 'abc', false)).toBe(true);
  });

  it('re-runs when there is no cached hash yet (first build)', () => {
    expect(needsTranscode(undefined, 'abc', false)).toBe(true);
    expect(needsTranscode(undefined, 'abc', true)).toBe(true);
  });
});
