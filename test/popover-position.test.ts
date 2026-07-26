import { describe, expect, it } from 'vitest';
import { computePopoverPosition, VIEWPORT_GUTTER } from '../src/lib/popover-position';

const VIEWPORT = { width: 1280, height: 800 };
const POPOVER = { width: 260, height: 320 };

describe('computePopoverPosition: vertical (opens upward)', () => {
  it('places the bottom edge VIEWPORT_GUTTER above the anchor top', () => {
    const { bottom } = computePopoverPosition({
      anchor: { top: 700, right: 220 },
      popover: POPOVER,
      viewport: VIEWPORT,
    });
    // bottom is measured from the viewport's bottom edge, so this is the
    // literal brief formula: innerHeight - rect.top + 8.
    expect(bottom).toBe(VIEWPORT.height - 700 + VIEWPORT_GUTTER);
    expect(bottom).toBe(108);
  });

  it('is a pure function of anchor.top -- an anchor higher up yields a larger bottom offset (below the clamp)', () => {
    const low = computePopoverPosition({ anchor: { top: 760, right: 220 }, popover: POPOVER, viewport: VIEWPORT });
    const high = computePopoverPosition({ anchor: { top: 400, right: 220 }, popover: POPOVER, viewport: VIEWPORT });
    expect(high.bottom).toBeGreaterThan(low.bottom);
  });
});

describe('computePopoverPosition: vertical clamp (top edge never passes the top gutter)', () => {
  // Found live, not hypothetical: the SystemCard theme row (the second, remote
  // trigger -- src/components/SystemCard.astro) sits well up a normal 800px
  // desktop viewport. Opening upward with NO vertical clamp put the popover's
  // top edge ~185px above the viewport -- max-height + internal scroll didn't
  // help because the popover's natural height never reached that cap, so
  // nothing forced it to shrink; the box was simply positioned too high.
  const anchor = { top: 325, right: 1113 }; // the SystemCard row, ~1280x800 viewport
  const tallPopover = { width: 260, height: 503 }; // matches the live measurement

  it('clamps bottom so the top edge lands at (or below) the top gutter, not off-screen', () => {
    const { bottom } = computePopoverPosition({ anchor, popover: tallPopover, viewport: VIEWPORT });
    const topEdge = VIEWPORT.height - bottom - tallPopover.height;
    expect(topEdge).toBeGreaterThanOrEqual(VIEWPORT_GUTTER - 1); // floating point
  });

  it('without the clamp this scenario WOULD go negative -- pins the regression', () => {
    const unclamped = VIEWPORT.height - anchor.top + VIEWPORT_GUTTER; // the raw "opens upward" formula
    const topEdgeIfUnclamped = VIEWPORT.height - unclamped - tallPopover.height;
    expect(topEdgeIfUnclamped).toBeLessThan(0); // confirms the scenario actually exercises the clamp
  });

  it('does not engage the clamp -- and matches the plain upward formula -- when there is enough headroom', () => {
    const roomyAnchor = { top: 700, right: 220 };
    const { bottom } = computePopoverPosition({ anchor: roomyAnchor, popover: POPOVER, viewport: VIEWPORT });
    expect(bottom).toBe(VIEWPORT.height - roomyAnchor.top + VIEWPORT_GUTTER);
  });
});

describe('computePopoverPosition: horizontal (right-aligns, then clamps)', () => {
  it('right-aligns to the anchor when there is room on both sides', () => {
    const { left } = computePopoverPosition({
      anchor: { top: 700, right: 800 }, // mid-viewport anchor, plenty of room
      popover: POPOVER,
      viewport: VIEWPORT,
    });
    expect(left).toBe(800 - POPOVER.width); // 540, unclamped
  });

  it('clamps to the left gutter when right-aligning would push it off the left edge -- the reported bug', () => {
    // The sidebar rail is 240px wide; a pill near its left edge right-aligned
    // to a 260px popover would put the left edge at a negative x. This is the
    // exact defect: half the popover rendered off the left viewport edge.
    const { left } = computePopoverPosition({
      anchor: { top: 700, right: 100 },
      popover: POPOVER,
      viewport: VIEWPORT,
    });
    expect(left).toBe(VIEWPORT_GUTTER);
  });

  it('clamps to the right gutter when the anchor sits close to the right edge', () => {
    const { left } = computePopoverPosition({
      anchor: { top: 700, right: VIEWPORT.width - 4 }, // 4px from the right edge
      popover: POPOVER,
      viewport: VIEWPORT,
    });
    // Right edge of the popover must land exactly VIEWPORT_GUTTER from the
    // viewport's right edge, not 4px from it.
    expect(left).toBe(VIEWPORT.width - VIEWPORT_GUTTER - POPOVER.width);
    expect(left + POPOVER.width).toBe(VIEWPORT.width - VIEWPORT_GUTTER);
  });

  it('prioritizes the left gutter when the viewport is too narrow to satisfy both', () => {
    // A popover exactly at the CSS max-width cap (100vw - 16px) on a 320px
    // viewport: 8px on both sides is impossible if the anchor is off-center;
    // the left gutter wins rather than pushing further right past its own max.
    const narrowViewport = { width: 320, height: 700 };
    const cappedPopover = { width: 304, height: 200 }; // 320 - 16
    const { left } = computePopoverPosition({
      anchor: { top: 400, right: 160 },
      popover: cappedPopover,
      viewport: narrowViewport,
    });
    expect(left).toBe(VIEWPORT_GUTTER);
  });

  it('never places the popover left of the left gutter, even for an anchor flush against the edge', () => {
    const { left } = computePopoverPosition({
      anchor: { top: 700, right: 20 },
      popover: POPOVER,
      viewport: VIEWPORT,
    });
    expect(left).toBeGreaterThanOrEqual(VIEWPORT_GUTTER);
  });
});
