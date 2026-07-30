/**
 * Highlight colors used to be a fixed 5-value enum. They're still fully
 * supported (and are the only ones that automatically adapt per reading
 * theme -- light/dark/sepia/Kindle each define their own hex for exactly
 * these five names via CSS custom properties, see apps/web's globals.css)
 * -- but `HighlightColor` is now any string: either one of those five
 * legacy names, or a literal `#RRGGBB` hex value the user picked directly
 * (a curated preset, or fully custom via a hex input / color-wheel
 * picker). A custom hex can't get that automatic per-theme adaptation --
 * there's no way to know in advance what would look good against a theme
 * nobody's chosen yet -- so it renders as the same literal color in every
 * theme. That's a deliberate, explainable tradeoff for genuine free-form
 * color choice, not an oversight.
 */

export interface HighlightColorOption {
  /** A legacy name ("YELLOW") for the original five, or the hex value
   * itself (doubling as its own id) for everything else. */
  id: string;
  /** Reference hex -- the light-theme value for a legacy name (its real
   * rendering in the web reader is still theme-aware via CSS variables;
   * this is what non-theme-aware contexts fall back to: PDF canvas fills,
   * EPUB's injected styles, mobile, the small dot in highlight-list-item),
   * or the color itself for anything else. */
  hex: string;
  label: string;
}

/** The original five -- unchanged rendering for anyone who never touches
 * this setting, and for every highlight that predates it. */
export const LEGACY_HIGHLIGHT_COLORS: HighlightColorOption[] = [
  { id: "YELLOW", hex: "#F3DE9C", label: "Yellow" },
  { id: "GREEN", hex: "#BCDFC4", label: "Green" },
  { id: "BLUE", hex: "#BBD6E8", label: "Blue" },
  { id: "PINK", hex: "#EFCCDA", label: "Pink" },
  { id: "ORANGE", hex: "#F1CB9E", label: "Orange" },
];

const LEGACY_IDS = new Set(LEGACY_HIGHLIGHT_COLORS.map((c) => c.id));

/** A broader set to choose from in the highlight-bar customization
 * setting -- picked to work well specifically as a text-highlight
 * background (soft, desaturated, doesn't fight with the text sitting on
 * top of it) *and* to actually look distinct from one another and from
 * the legacy five at a glance -- an earlier version of this list packed
 * in ten colors at nearly the same pale, low-saturation tone (e.g. "Mint"
 * right next to "Teal" right next to Green), which just reads as
 * near-duplicates in a small swatch. Each of these is deliberately spaced
 * around the hue wheel away from the legacy five *and* from each other,
 * with saturation/lightness varied enough (not one flat formula) that
 * neighbors stay tell-apart-able. */
export const CURATED_HIGHLIGHT_PALETTE: HighlightColorOption[] = [
  ...LEGACY_HIGHLIGHT_COLORS,
  { id: "#F0A8A8", hex: "#F0A8A8", label: "Red" },
  { id: "#D9E68A", hex: "#D9E68A", label: "Lime" },
  { id: "#8FDCD4", hex: "#8FDCD4", label: "Teal" },
  { id: "#A8AEEA", hex: "#A8AEEA", label: "Indigo" },
  { id: "#C4A8E8", hex: "#C4A8E8", label: "Purple" },
  { id: "#DB8CC7", hex: "#DB8CC7", label: "Magenta" },
  { id: "#C9A876", hex: "#C9A876", label: "Brown" },
  { id: "#E0C468", hex: "#E0C468", label: "Gold" },
  { id: "#C2C7CC", hex: "#C2C7CC", label: "Gray" },
];

export const DEFAULT_HIGHLIGHT_COLOR = "YELLOW";

/** The default set shown in the highlight bar before anyone customizes it
 * -- the original five, so nothing changes for someone who never opens
 * this setting. */
export const DEFAULT_HIGHLIGHT_BAR_COLORS: string[] = LEGACY_HIGHLIGHT_COLORS.map((c) => c.id);

/** How many colors the highlight bar can hold at once -- generous enough
 * for real customization, capped so the popover doesn't turn into an
 * unusable wall of swatches. */
export const MAX_HIGHLIGHT_BAR_COLORS = 12;

export function isLegacyHighlightColor(color: string): boolean {
  return LEGACY_IDS.has(color);
}

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isValidHexColor(value: string): boolean {
  return HEX_PATTERN.test(value);
}

export function isValidHighlightColor(color: string): boolean {
  return isLegacyHighlightColor(color) || isValidHexColor(color);
}

/** The literal hex for any valid color value. */
export function highlightColorHex(color: string): string {
  const legacy = LEGACY_HIGHLIGHT_COLORS.find((c) => c.id === color);
  return legacy ? legacy.hex : color;
}

/** Same hex, as an `rgba()` string at the given alpha -- for fill overlays
 * (PDF canvas, EPUB range highlighting) that need transparency baked into
 * the color string itself rather than set via a separate CSS property. */
export function highlightColorRgba(color: string, alpha: number): string {
  const hex = highlightColorHex(color);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Sanitizes a device-local list of highlight-bar color ids read back from
 * storage: drops anything no longer valid, dedupes, enforces the max
 * count, and falls back to the default set if nothing valid survives. */
export function sanitizeHighlightBarColors(colors: unknown): string[] {
  if (!Array.isArray(colors)) return DEFAULT_HIGHLIGHT_BAR_COLORS;
  const seen = new Set<string>();
  const valid: string[] = [];
  for (const c of colors) {
    if (typeof c !== "string" || !isValidHighlightColor(c) || seen.has(c)) continue;
    seen.add(c);
    valid.push(c);
    if (valid.length >= MAX_HIGHLIGHT_BAR_COLORS) break;
  }
  return valid.length > 0 ? valid : DEFAULT_HIGHLIGHT_BAR_COLORS;
}
