/*
 * inert.ts -- background inertness for a manually-built modal overlay (the ⌘K
 * palette: Palette.astro renders a <div role="dialog" aria-modal="true">
 * inside a <command-palette> custom element, opened/closed by toggling
 * attributes -- NOT a native <dialog> shown with `showModal()`. None of the
 * modality a real showModal() dialog gets for free (background inertness,
 * focus containment) is automatic here; it has to be set by hand).
 *
 * Verified elsewhere in this codebase that this really is the "manual" case,
 * not the "native, already-inert" one: the mobile nav sheet (Shell.astro's
 * `<dialog data-nav-sheet>`, opened via `sheet.showModal()` in shell.ts) IS a
 * real native dialog and does NOT need this module -- the browser already
 * makes everything outside it inert while open (see Shell.astro's own comment
 * on that element: "Native <dialog> gives the focus trap, Esc-to-close, and
 * inert background for free").
 *
 * Why this matters for the palette even though it already traps Tab
 * (palette.ts's `case 'Tab': preventDefault()` keeps DOM focus pinned to the
 * input the whole time it's open): Tab-trapping only stops KEYBOARD tabbing.
 * A screen reader's own virtual cursor (swipe navigation, browse-mode arrow
 * keys) or a stray pointer event doesn't go through that keydown handler at
 * all, and could otherwise still reach "background" content sitting right
 * behind the overlay. `inert` closes that gap for every input modality, not
 * just Tab -- defense in depth, matching the ARIA APG's custom-dialog
 * guidance for a hand-rolled (non-native) dialog.
 *
 * Applied to the palette's own SIBLINGS (Base.astro's <body>: the skip link,
 * the topbar, the .shell grid, the mobile nav dialog), never to an ancestor
 * of the dialog -- inerting an ancestor would make the dialog itself inert.
 */

/**
 * Toggle `inert` on every direct child of `root` EXCEPT `keep`. Symmetric:
 * calling with `value: false` removes exactly the attribute the `true` call
 * would have added, so open/close is idempotent in either direction (safe to
 * call from every close path -- Esc, backdrop click, a "Jump to" navigation,
 * or a defensive cleanup on disconnect -- without tracking which one fired).
 */
export function setBackgroundInert(root: ParentNode, keep: Element, value: boolean): void {
  for (const el of Array.from(root.children)) {
    if (el === keep) continue;
    if (value) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }
}
