"use client";

import { useEffect, useRef, useState } from "react";
import { hexToHsv, hsvToHex, type Hsv } from "@/lib/reader/color-conversion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

interface ColorWheelPickerProps {
  /** Starting color when the popover opens. */
  initialHex: string;
  onAdd: (hex: string) => void;
}

/**
 * A real color-wheel picker rendered in Booklet's own theme, not the
 * browser's native `<input type="color">` -- the native picker is a
 * separate OS/browser-chrome dialog no page can restyle, which looks like
 * it belongs to a completely different app. This is a saturation/value
 * square plus a hue strip, both draggable, kept in sync with a hex field.
 */
export function ColorWheelPicker({ initialHex, onAdd }: ColorWheelPickerProps) {
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(initialHex));
  // Non-null only while the user is actively typing a hex value -- lets the
  // field show the wheel's live hex (derived, not duplicated in state) the
  // rest of the time, with no effect needed to keep the two in sync.
  const [editingHex, setEditingHex] = useState<string | null>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const hex = hsvToHex(hsv);
  const hexFieldValue = editingHex ?? hex;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function updateFromSvPointer(clientX: number, clientY: number) {
    const el = svRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const v = 1 - Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    setHsv((prev) => ({ ...prev, s, v }));
  }

  function updateFromHuePointer(clientX: number) {
    const el = hueRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setHsv((prev) => ({ ...prev, h: fraction * 360 }));
  }

  function handleSvPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromSvPointer(e.clientX, e.clientY);
  }

  function handleHuePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromHuePointer(e.clientX);
  }

  function applyHexDraft(raw: string) {
    const normalized = raw.startsWith("#") ? raw : `#${raw}`;
    if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
      setHsv(hexToHsv(normalized.toUpperCase()));
    }
    setEditingHex(null);
  }

  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 });

  return (
    <div className="relative inline-block">
      <button
        type="button"
        title="Open the color wheel"
        onClick={() => setOpen((v) => !v)}
        className="h-9 w-9 shrink-0 rounded-sm border border-border"
        style={{ backgroundColor: hex }}
      />

      {open && (
        <div
          ref={popoverRef}
          className="absolute left-0 top-11 z-50 w-56 rounded-md border border-border bg-surface p-3 shadow-lg"
        >
          <div
            ref={svRef}
            onPointerDown={handleSvPointerDown}
            onPointerMove={(e) => e.buttons === 1 && updateFromSvPointer(e.clientX, e.clientY)}
            className="relative h-32 w-full cursor-crosshair touch-none rounded-sm"
            style={{
              backgroundColor: hueColor,
              backgroundImage:
                "linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0))",
            }}
          >
            <div
              className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
            />
          </div>

          <div
            ref={hueRef}
            onPointerDown={handleHuePointerDown}
            onPointerMove={(e) => e.buttons === 1 && updateFromHuePointer(e.clientX)}
            className="relative mt-2.5 h-3 w-full cursor-pointer touch-none rounded-full"
            style={{
              background:
                "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
            }}
          >
            <div
              className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-transparent shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
              style={{ left: `${(hsv.h / 360) * 100}%` }}
            />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <div className="h-7 w-7 shrink-0 rounded-sm border border-border" style={{ backgroundColor: hex }} />
            <input
              type="text"
              value={hexFieldValue}
              onChange={(e) => setEditingHex(e.target.value)}
              onBlur={() => applyHexDraft(hexFieldValue)}
              onKeyDown={(e) => e.key === "Enter" && applyHexDraft(hexFieldValue)}
              maxLength={7}
              className={cn(
                "min-w-0 flex-1 rounded-sm border border-border bg-paper px-2 py-1.5 font-mono text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent",
              )}
            />
          </div>

          <Button
            type="button"
            variant="primary"
            className="mt-2.5 w-full px-3 py-1.5 text-xs"
            onClick={() => {
              onAdd(hex);
              setOpen(false);
            }}
          >
            Add to bar
          </Button>
        </div>
      )}
    </div>
  );
}
