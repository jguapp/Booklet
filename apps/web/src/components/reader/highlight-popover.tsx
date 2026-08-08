"use client";

import { useEffect, useRef, useState } from "react";
import type { HighlightColor } from "@booklet/shared";
import { CURATED_HIGHLIGHT_PALETTE, highlightColorHex } from "@booklet/shared";
import { cn } from "@/lib/cn";
import { isLookupableWord, lookupWord, type DictionaryEntry } from "@/lib/dictionary";
import { IconBook } from "@/components/ui/icons";
import { useDevicePrefs } from "@/lib/data/device-prefs-provider";

const PALETTE_LABELS = new Map(CURATED_HIGHLIGHT_PALETTE.map((c) => [c.id, c.label]));

function labelFor(color: string): string {
  return PALETTE_LABELS.get(color) ?? color;
}

/** How far the page has to actually move before an open popover is dismissed.
 * Small enough that any deliberate scroll closes it, large enough to absorb
 * a stale scroll event for scrolling that had already finished (see the
 * scroll handler below) and sub-pixel scrollY jitter. */
const SCROLL_DISMISS_PX = 8;

/**
 * Whether the page has moved far enough since the popover opened to dismiss
 * it. Named rather than inlined because the rule is subtle enough to have
 * already been wrong once. It used to be exported so it could be unit-tested
 * in isolation, which #166 made unnecessary -- highlight-popover.test.tsx now
 * drives the real component through real scroll events.
 */
function hasScrolledAway(openedAtScrollY: number, currentScrollY: number): boolean {
  return Math.abs(currentScrollY - openedAtScrollY) > SCROLL_DISMISS_PX;
}

type Panel = "none" | "note" | "define";
type DictStatus = "idle" | "loading" | "error" | "not-found" | "found";

interface HighlightPopoverProps {
  /** Viewport position to anchor the popover above (e.g. selection bounding rect). */
  anchorRect: DOMRect;
  /** The actual selected text -- used to offer "Look up" only for a single word, Apple Books-style. */
  selectedText?: string;
  onConfirm: (color: HighlightColor, note: string) => void;
  onDismiss: () => void;
}

export function HighlightPopover({ anchorRect, selectedText, onConfirm, onDismiss }: HighlightPopoverProps) {
  const { reader } = useDevicePrefs();
  const barColors = reader.highlightBarColors;
  const [color, setColor] = useState<HighlightColor>(() => barColors[0] ?? "YELLOW");
  const [panel, setPanel] = useState<Panel>("none");
  const [note, setNote] = useState("");
  const [dictStatus, setDictStatus] = useState<DictStatus>("idle");
  const [dictEntry, setDictEntry] = useState<DictionaryEntry | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const lookupable = !!selectedText && isLookupableWord(selectedText);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    // Dismissing on *any* scroll event was too eager. The reason to dismiss
    // at all is that anchorRect is viewport-relative and goes stale once the
    // page moves -- so what matters is whether the page has actually moved
    // since this popover opened, not whether a scroll event arrived.
    //
    // Those are different things, because a scroll event can be dispatched
    // on a later frame than the scrolling that caused it: a programmatic
    // scrollIntoView, or ordinary momentum/inertial scrolling (which keeps
    // emitting for hundreds of milliseconds after the fingers leave the
    // trackpad). Either can deliver an event *after* the popover mounts, for
    // scrolling that finished before it existed -- closing the popover the
    // reader just opened, with no scrolling on their part in between.
    //
    // Comparing against the position captured at mount makes those no-ops,
    // since the page is already where the event says it is. A real scroll
    // still moves scrollY and still dismisses.
    const openedAtScrollY = window.scrollY;
    function handleScroll() {
      if (hasScrolledAway(openedAtScrollY, window.scrollY)) onDismiss();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [onDismiss]);

  function toggleDefine() {
    if (panel === "define") {
      setPanel("none");
      return;
    }
    setPanel("define");
    if (dictStatus !== "idle" || !selectedText) return;
    setDictStatus("loading");
    lookupWord(selectedText)
      .then((entry) => {
        setDictEntry(entry);
        setDictStatus(entry ? "found" : "not-found");
      })
      .catch(() => setDictStatus("error"));
  }

  // `fixed`, positioned directly from the viewport-relative anchorRect --
  // deliberately not `absolute` + `window.scrollX/scrollY`, which only
  // lands correctly when the nearest positioned ancestor is the document
  // root. This popover's ancestor varies by reader (a local `position:
  // relative` wrapper nested deep in the page for the HTML reader, versus
  // near the document root for PDF/EPUB), so document-relative coordinates
  // landed it far from the actual selection in the HTML case.
  const top = anchorRect.top - 12;
  const left = anchorRect.left + anchorRect.width / 2;

  return (
    <div
      ref={ref}
      className="fixed z-50 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface p-3 shadow-lg"
      style={{ top, left }}
    >
      <div className="flex items-center gap-1.5">
        {barColors.map((c) => (
          <button
            key={c}
            type="button"
            title={labelFor(c)}
            onClick={() => {
              setColor(c);
              if (panel === "none") onConfirm(c, "");
            }}
            style={{ backgroundColor: highlightColorHex(c) }}
            className={cn(
              "h-6 w-6 rounded-full border-2 transition-transform hover:scale-110",
              color === c ? "border-ink" : "border-transparent",
            )}
          />
        ))}
        <div className="mx-1 h-5 w-px bg-border" />
        {lookupable && (
          <button
            type="button"
            title="Look up"
            onClick={toggleDefine}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink",
              panel === "define" && "bg-surface-2 text-accent",
            )}
          >
            <IconBook className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          title="Add a note"
          onClick={() => setPanel((p) => (p === "note" ? "none" : "note"))}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink",
            panel === "note" && "bg-surface-2 text-accent",
          )}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-3.5 w-3.5">
            <path d="M2 3h12M2 8h8M2 13h5" />
          </svg>
        </button>
      </div>

      {panel === "note" && (
        <div className="mt-2.5 flex flex-col gap-2">
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Note"
            placeholder="Add a note…"
            rows={2}
            className="w-56 resize-none rounded-sm border border-border bg-paper px-2.5 py-2 font-sans text-sm text-ink placeholder:text-ink-faint outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <button
            type="button"
            onClick={() => onConfirm(color, note)}
            className="self-end rounded-sm bg-accent px-3 py-1.5 font-sans text-xs font-semibold text-accent-contrast hover:bg-accent-strong"
          >
            Save highlight
          </button>
        </div>
      )}

      {panel === "define" && (
        <div className="mt-2.5 w-64">
          {dictStatus === "loading" && <p className="font-sans text-xs text-ink-faint">Looking up…</p>}
          {dictStatus === "error" && (
            <p className="font-sans text-xs text-ink-faint">Couldn&apos;t reach the dictionary.</p>
          )}
          {dictStatus === "not-found" && (
            <p className="font-sans text-xs text-ink-faint">No definition found for &ldquo;{selectedText}&rdquo;.</p>
          )}
          {dictStatus === "found" && dictEntry && (
            <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
              <div className="flex items-baseline gap-2">
                <span className="font-serif text-sm font-semibold text-ink">{dictEntry.word}</span>
                {dictEntry.phonetic && (
                  <span className="font-sans text-xs text-ink-faint">{dictEntry.phonetic}</span>
                )}
              </div>
              {dictEntry.meanings.map((m, i) => (
                <div key={i}>
                  <p className="font-sans text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                    {m.partOfSpeech}
                  </p>
                  <p className="font-sans text-sm text-ink">{m.definition}</p>
                  {m.example && (
                    <p className="font-sans text-xs italic text-ink-faint">&ldquo;{m.example}&rdquo;</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
