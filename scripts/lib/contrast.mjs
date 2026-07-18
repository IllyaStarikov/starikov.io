// WCAG 2.x relative luminance + contrast ratio, plus a small helper that
// derives an accessible "muted but still readable" text color by mixing
// fg toward bg in sRGB space until the last step that still clears a
// target contrast floor.
//
// Spec: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
//       https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio

/** @param {string} hex e.g. "#c0caf5" */
function hexToRgb(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) throw new Error(`contrast: invalid hex color "${hex}"`);
  const int = parseInt(m[1], 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function channelToLinear(c) {
  const cs = c / 255;
  return cs <= 0.04045 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

/** Relative luminance of a hex color, per WCAG 2.x. Returns a value in [0, 1]. */
export function relLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const R = channelToLinear(r);
  const G = channelToLinear(g);
  const B = channelToLinear(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG contrast ratio between two hex colors. Symmetric; range [1, 21]. */
export function contrastRatio(a, b) {
  const La = relLuminance(a);
  const Lb = relLuminance(b);
  const lighter = Math.max(La, Lb);
  const darker = Math.min(La, Lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function toHex2(n) {
  return Math.round(n).toString(16).padStart(2, '0');
}

/** Linear (non-gamma-aware) mix of two hex colors in sRGB space; t=0 -> a, t=1 -> b. */
function mix(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const r = ca.r + (cb.r - ca.r) * t;
  const g = ca.g + (cb.g - ca.g) * t;
  const bl = ca.b + (cb.b - ca.b) * t;
  return `#${toHex2(r)}${toHex2(g)}${toHex2(bl)}`;
}

/**
 * Mix fg toward bg in sRGB until the LAST step that still meets `floor` vs bg.
 * If fg itself does not meet floor at t=0, falls back to fg unchanged.
 */
export function deriveToFloor(fg, bg, floor) {
  let best = fg;
  for (let t = 0; t <= 0.7; t += 0.02) {
    const c = mix(fg, bg, t);
    if (contrastRatio(c, bg) >= floor) {
      best = c;
    } else {
      break;
    }
  }
  return best;
}

export const deriveTextTokens = (fg, bg) => ({
  textSecondary: deriveToFloor(fg, bg, 4.5),
  codeComment: deriveToFloor(fg, bg, 3.0),
});
