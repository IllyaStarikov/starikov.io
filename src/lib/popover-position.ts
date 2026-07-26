/*
 * Pure position math for ThemeControl's JS-anchored `position: fixed` popover
 * (src/scripts/theme-control.ts). Kept dependency-free -- plain numeric rects
 * in, {left, bottom} out -- so it is unit-testable with stubbed rects. jsdom/
 * linkedom don't compute real layout (getBoundingClientRect always answers
 * zeros), so a DOM-level test of this math would just be asserting a stub
 * back at itself; testing the pure function directly is the honest version.
 *
 * Why position:fixed at all: the popover used to be `position: absolute;
 * right: 0` anchored to its trigger, which was fine until that trigger moved
 * into the sidebar footer -- the sidebar is `overflow-y: auto` (Shell.astro,
 * >=1024px), and it clips anything that would render outside its own
 * scrollport. A 260px dropdown right-aligned inside a 240px rail does exactly
 * that: half of it renders off the clipped edge. `position: fixed` escapes
 * the clip (verified: nothing between #theme-popover and the viewport --
 * .sidebar, .shell -- sets a transform/filter/perspective/contain, so no
 * ancestor creates a fixed containing block), but a fixed element has to
 * compute its own on-screen position in JS instead of inheriting one from
 * flow layout. That's what this module does.
 */

export interface PopoverGeometry {
  /** The opening trigger's getBoundingClientRect() (or an equivalent stub). */
  anchor: { top: number; right: number };
  /** The popover's own rendered size, measured pre-visible (see theme-control.ts). */
  popover: { width: number; height: number };
  /** The viewport: window.innerWidth/innerHeight. */
  viewport: { width: number; height: number };
}

export interface PopoverPosition {
  left: number;
  bottom: number;
}

/** Minimum clearance kept between the popover and every viewport edge. */
export const VIEWPORT_GUTTER = 8;

/**
 * Prefers opening UPWARD from the anchor: `bottom` places the popover's
 * bottom edge VIEWPORT_GUTTER above the anchor's top edge (both real
 * triggers -- the sidebar footer pill, the SystemCard theme row -- sit low
 * enough in their contexts that upward is the useful default).
 *
 * That preferred `bottom` is then clamped so the popover's TOP edge never
 * passes above the top gutter -- verified live: the SystemCard theme row (the
 * second, remote trigger) sits ~325px down a standard 800px-tall viewport, and
 * the popover's own natural height (~500px, well under the CSS `max-height`
 * cap) pushed its top edge ~185px above the viewport with no clamp at all.
 * `max-height` + internal scroll only bounds the popover's OWN size; it does
 * nothing to reposition a box whose (uncapped) `bottom` offset is simply
 * larger than the viewport has room for above it. The fix mirrors the `left`
 * clamp below exactly, just on the other axis.
 *
 * `left` defaults to right-aligning the popover with the anchor (matching the
 * control's previous right-aligned dropdown look), then clamps into the
 * viewport with a VIEWPORT_GUTTER gutter on both sides -- the original,
 * brief-specified fix: the old CSS version had no clamp at all, so a narrow
 * sidebar rail let the popover's left edge run off the viewport.
 */
export function computePopoverPosition({ anchor, popover, viewport }: PopoverGeometry): PopoverPosition {
  const preferredBottom = viewport.height - anchor.top + VIEWPORT_GUTTER;
  const maxBottom = viewport.height - VIEWPORT_GUTTER - popover.height;
  const bottom = Math.min(preferredBottom, maxBottom);

  const preferredLeft = anchor.right - popover.width;
  const maxLeft = viewport.width - VIEWPORT_GUTTER - popover.width;
  const left = Math.max(VIEWPORT_GUTTER, Math.min(preferredLeft, maxLeft));

  return { left, bottom };
}
