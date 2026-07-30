"use client";

import { useState } from "react";
import { CURATED_HIGHLIGHT_PALETTE, MAX_HIGHLIGHT_BAR_COLORS, highlightColorHex, isValidHexColor } from "@booklet/shared";
import { useDevicePrefs } from "@/lib/data/device-prefs-provider";
import { Button } from "@/components/ui/button";
import { IconCheck } from "@/components/ui/icons";
import { ColorWheelPicker } from "./color-wheel-picker";
import { cn } from "@/lib/cn";

const PALETTE_LABELS = new Map(CURATED_HIGHLIGHT_PALETTE.map((c) => [c.id, c.label]));

function labelFor(color: string): string {
  return PALETTE_LABELS.get(color) ?? color;
}

function normalizeHexInput(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("#") ? trimmed.toUpperCase() : `#${trimmed}`.toUpperCase();
}

/**
 * Which colors appear in the highlight picker (highlight-popover.tsx) when
 * selecting text, and how many -- a device-local preference (reader.
 * highlightBarColors), not account-synced, same reasoning as text size/TTS
 * voice: what looks good is a property of your own eyes, not your account.
 * Three ways in: toggle any of the curated palette on/off, type a hex code
 * directly, or drag around Booklet's own themed color wheel
 * (color-wheel-picker.tsx) -- not the browser's native `<input
 * type="color">`, whose popup is an unstylable OS/browser-chrome dialog.
 */
export function HighlightColorPicker() {
  const { reader, setHighlightBarColors } = useDevicePrefs();
  const bar = reader.highlightBarColors;
  const [customHex, setCustomHex] = useState("#7EC8E3");
  const [hexDraft, setHexDraft] = useState("");
  const [hexError, setHexError] = useState(false);

  function toggle(id: string) {
    if (bar.includes(id)) {
      if (bar.length <= 1) return; // always keep at least one color to highlight with
      setHighlightBarColors(bar.filter((c) => c !== id));
    } else {
      if (bar.length >= MAX_HIGHLIGHT_BAR_COLORS) return;
      setHighlightBarColors([...bar, id]);
    }
  }

  function remove(id: string) {
    if (bar.length <= 1) return;
    setHighlightBarColors(bar.filter((c) => c !== id));
  }

  function addHex(raw: string) {
    const normalized = normalizeHexInput(raw);
    if (!isValidHexColor(normalized)) {
      setHexError(true);
      return;
    }
    setHexError(false);
    setHexDraft("");
    if (bar.includes(normalized) || bar.length >= MAX_HIGHLIGHT_BAR_COLORS) return;
    setHighlightBarColors([...bar, normalized]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="font-sans text-xs font-medium text-ink-muted">
            Your highlight bar ({bar.length} of {MAX_HIGHLIGHT_BAR_COLORS})
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-3">
          {bar.map((c) => (
            <div key={c} className="group relative">
              <div
                title={labelFor(c)}
                className="h-8 w-8 rounded-full border border-border"
                style={{ backgroundColor: highlightColorHex(c) }}
              />
              {bar.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(c)}
                  aria-label={`Remove ${labelFor(c)} from the highlight bar`}
                  className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-ink font-sans text-[10px] leading-none text-paper hover:bg-red-500 group-hover:flex"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-sans text-xs font-medium text-ink-muted">Choose from a curated palette</span>
        <div className="flex flex-wrap gap-2">
          {CURATED_HIGHLIGHT_PALETTE.map((c) => {
            const active = bar.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                title={c.label}
                onClick={() => toggle(c.id)}
                disabled={!active && bar.length >= MAX_HIGHLIGHT_BAR_COLORS}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border-2 transition-transform hover:scale-110 disabled:opacity-40 disabled:hover:scale-100",
                  // A fixed dark ring, not the theme's --color-ink (which
                  // flips to a pale color in dark mode) -- these swatches
                  // are always pale pastels regardless of app theme, so
                  // the "selected" indicator needs to contrast against the
                  // *swatch*, not the page background.
                  active ? "border-[#1B1815]" : "border-transparent",
                )}
                style={{ backgroundColor: c.hex }}
              >
                {active && <IconCheck className="h-3.5 w-3.5 text-[#1B1815]" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-sans text-xs font-medium text-ink-muted">Or pick a fully custom color</span>
        <div className="flex items-center gap-2">
          <ColorWheelPicker
            initialHex={customHex}
            onAdd={(hex) => {
              setCustomHex(hex);
              addHex(hex);
            }}
          />
          <div className="mx-1 h-6 w-px bg-border" />
          <input
            type="text"
            value={hexDraft}
            onChange={(e) => {
              setHexDraft(e.target.value);
              setHexError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") addHex(hexDraft);
            }}
            placeholder="#7EC8E3"
            maxLength={7}
            className={cn(
              "w-28 rounded-sm border bg-surface px-2.5 py-1.5 font-mono text-sm text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent",
              hexError ? "border-red-400" : "border-border",
            )}
          />
          <Button type="button" variant="secondary" onClick={() => addHex(hexDraft)} disabled={!hexDraft || bar.length >= MAX_HIGHLIGHT_BAR_COLORS}>
            Add hex
          </Button>
        </div>
        {hexError && <p className="font-sans text-xs text-red-500">Enter a valid hex color, like #7EC8E3.</p>}
      </div>
    </div>
  );
}
