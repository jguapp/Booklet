"use client";

import { useEffect, useRef, useState } from "react";
import ePub from "epubjs";
import type { Rendition, Contents } from "epubjs";
import type { Highlight, HighlightColor } from "@booklet/shared";
import type { Theme } from "@/lib/theme/theme-provider";
import type { ReaderSize } from "./reader-toolbar";
import { HighlightPopover } from "./highlight-popover";
import { HighlightManagePopover } from "./highlight-manage-popover";

const HIGHLIGHT_FILL: Record<HighlightColor, string> = {
  YELLOW: "#F3DE9C",
  GREEN: "#BCDFC4",
  BLUE: "#BBD6E8",
  PINK: "#EFCCDA",
  ORANGE: "#F1CB9E",
};

const THEME_COLORS: Record<Theme, { bg: string; fg: string }> = {
  light: { bg: "#FAF9F4", fg: "#211F1A" },
  dark: { bg: "#1C2124", fg: "#E8E4DA" },
  sepia: { bg: "#DDCB9C", fg: "#392E1C" },
};

const SIZE_PERCENT: Record<ReaderSize, string> = { sm: "90%", md: "105%", lg: "120%", xl: "135%" };

interface EpubReaderProps {
  fileBlob: Blob;
  highlights: Highlight[];
  theme: Theme;
  size: ReaderSize;
  initialProgressFraction: number;
  onProgressChange: (fraction: number) => void;
  /** The current section's plain text, for read-aloud -- re-reported on every relocate. */
  onSectionTextChange?: (text: string) => void;
  onCreateHighlight: (cfiRange: string, selectedText: string, color: HighlightColor, note: string) => void;
  onDeleteHighlight: (highlightId: string) => void;
  onSaveNote: (highlightId: string, noteText: string) => void;
  onDeleteNote: (highlightId: string) => void;
}

interface PendingSelection {
  cfiRange: string;
  selectedText: string;
  rect: DOMRect;
}

interface ManagingHighlight {
  highlight: Highlight;
  rect: DOMRect;
}

function isEpubHighlight(h: Highlight): h is Highlight & { position: { type: "epub"; cfi: string } } {
  return h.position.type === "epub";
}

// contents.window is the iframe's own window (epub.js renders each spine
// section in its own iframe) -- a selection rect from there is relative to
// that iframe's viewport, not this component's. Find the actual <iframe>
// element from the parent document to translate into page coordinates;
// epub.js's public Contents API exposes the window but not the frame
// element itself.
function frameOffset(contentsWindow: Window): { left: number; top: number } {
  const frames = document.querySelectorAll("iframe");
  for (const frame of frames) {
    if (frame.contentWindow === contentsWindow) {
      const r = frame.getBoundingClientRect();
      return { left: r.left, top: r.top };
    }
  }
  return { left: 0, top: 0 };
}

export function EpubReader({
  fileBlob,
  highlights,
  theme,
  size,
  initialProgressFraction,
  onProgressChange,
  onSectionTextChange,
  onCreateHighlight,
  onDeleteHighlight,
  onSaveNote,
  onDeleteNote,
}: EpubReaderProps) {
  const [rendition, setRendition] = useState<Rendition | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [locationLabel, setLocationLabel] = useState("");
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [managing, setManaging] = useState<ManagingHighlight | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const highlightsRef = useRef<Highlight[]>(highlights);
  useEffect(() => {
    highlightsRef.current = highlights;
  }, [highlights]);

  // Read through refs inside the file-open effect below instead of adding
  // them as dependencies -- onProgressChange is a fresh function identity
  // every parent render, and re-opening the whole book on that would both
  // reset the reading position and re-run the (non-trivial) locations.generate() pass.
  const initialProgressRef = useRef(initialProgressFraction);
  const onProgressChangeRef = useRef(onProgressChange);
  const onSectionTextChangeRef = useRef(onSectionTextChange);
  useEffect(() => {
    initialProgressRef.current = initialProgressFraction;
    onProgressChangeRef.current = onProgressChange;
    onSectionTextChangeRef.current = onSectionTextChange;
  }, [initialProgressFraction, onProgressChange, onSectionTextChange]);

  // Open the book and render it into viewerRef once per file. epub.js owns
  // the iframe(s) inside that div entirely -- nothing else touches its DOM.
  useEffect(() => {
    if (!viewerRef.current) return;
    let cancelled = false;
    setLoadError(null);

    // Whether book.locations.generate() (below) has finished -- percentage
    // is meaningless before that, but it's *also* exactly 0 for a real,
    // ready position near the start of a short book/chapter, so it can't be
    // used as its own readiness signal (that's what silently dropped
    // progress here: relocating to chapter two of a short book still
    // reports percentage 0, indistinguishable from "not ready yet").
    let locationsReady = false;
    // The cfi of the most recent relocate, tracked regardless of readiness,
    // so a relocate that lands while generate() is still running isn't lost
    // -- once ready, its percentage gets computed from here instead of from
    // a live currentLocation() query (which raced the manager's own
    // still-settling state and read stale results some of the time).
    let lastKnownCfi: string | null = null;

    async function open() {
      try {
        const data = await fileBlob.arrayBuffer();
        const book = ePub(data);
        const r = book.renderTo(viewerRef.current!, { width: "100%", height: "100%", flow: "paginated" });
        await r.display();
        if (cancelled) {
          r.destroy();
          return;
        }

        r.on("selected", (cfiRange: string, contents: Contents) => {
          const selection = contents.window.getSelection();
          const selectedText = selection?.toString().trim() ?? "";
          if (!selectedText || !selection || selection.rangeCount === 0) return;
          const range = selection.getRangeAt(0);
          const localRect = range.getBoundingClientRect();
          const offset = frameOffset(contents.window);
          const rect = new DOMRect(localRect.x + offset.left, localRect.y + offset.top, localRect.width, localRect.height);
          setPending({ cfiRange, selectedText, rect });
        });

        r.on(
          "relocated",
          (location: { start: { cfi: string; displayed: { page: number; total: number }; percentage: number } }) => {
            setLocationLabel(`Page ${location.start.displayed.page} of ${location.start.displayed.total}`);
            lastKnownCfi = location.start.cfi;
            if (locationsReady) onProgressChangeRef.current(location.start.percentage);

            // Same Contents[]-not-Contents typing mismatch as handleConfirm
            // below -- one Contents per currently-rendered iframe/section.
            const contents = r.getContents() as unknown as Contents[] | undefined;
            const sectionText = contents?.map((c) => c.document.body?.textContent ?? "").join("\n\n").trim();
            if (sectionText) onSectionTextChangeRef.current?.(sectionText);
          },
        );

        setRendition(r);

        // Builds a whole-book location index (epub.js's own mechanism for
        // turning "percentage" and page counts into more than per-section
        // guesses) -- not needed to render or highlight, only for resuming
        // at the right spot and reporting accurate progress, so it runs
        // after display() rather than blocking the reader on it.
        await book.locations.generate(1024);
        if (cancelled) return;
        locationsReady = true;

        // A relocate (e.g. the reader clicking Next) that lands while
        // generate() above is still running arrives with locationsReady
        // still false, so the relocated handler drops it -- correctly,
        // since percentage is meaningless before locations exist, but
        // nothing re-fires it once ready either, so that position would
        // otherwise be lost for good. Catch up using whatever cfi the last
        // relocate actually reported, now that it can be turned into a
        // percentage.
        if (lastKnownCfi) {
          const pct = book.locations.percentageFromCfi(lastKnownCfi);
          if (typeof pct === "number" && pct >= 0) onProgressChangeRef.current(pct);
        }

        const resumeAt = initialProgressRef.current;
        if (resumeAt > 0) {
          const cfi = book.locations.cfiFromPercentage(resumeAt);
          if (cfi) await r.display(cfi);
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Couldn't open this EPUB.");
      }
    }

    open();
    return () => {
      cancelled = true;
      setRendition((prev) => {
        prev?.destroy();
        return null;
      });
    };
  }, [fileBlob]);

  // Theme + font size, reapplied whenever either changes (and to every
  // newly-rendered section -- epub.js re-injects themes.default() content
  // into each new iframe automatically once registered).
  useEffect(() => {
    if (!rendition) return;
    const { bg, fg } = THEME_COLORS[theme];
    rendition.themes.default({
      body: { background: `${bg} !important`, color: `${fg} !important` },
      "::selection": { background: "rgba(31, 111, 107, 0.35)" },
    });
    rendition.themes.fontSize(SIZE_PERCENT[size]);
  }, [rendition, theme, size]);

  // Keep the rendered highlight annotations in sync with the highlights
  // list -- epub.js's annotations.add()/.remove() are the primitives; this
  // effect just reconciles rather than tracking a delta itself.
  useEffect(() => {
    if (!rendition) return;
    const epubHighlights = highlights.filter(isEpubHighlight);
    for (const h of epubHighlights) {
      rendition.annotations.remove(h.position.cfi, "highlight");
      rendition.annotations.highlight(
        h.position.cfi,
        { highlightId: h.id },
        (event: MouseEvent) => {
          const current = highlightsRef.current.find((x) => x.id === h.id);
          if (!current) return;
          const target = event.target as HTMLElement;
          setManaging({ highlight: current, rect: target.getBoundingClientRect() });
        },
        "epub-highlight",
        {
          fill: HIGHLIGHT_FILL[h.color],
          "fill-opacity": "0.55",
          "mix-blend-mode": "multiply",
          // The overlay <svg> marks-pane renders into has pointer-events:
          // none (so empty space over the text stays clickable/selectable);
          // each mark needs its own override back to receive clicks at all.
          "pointer-events": "auto",
          cursor: "pointer",
        },
      );
    }
    return () => {
      for (const h of epubHighlights) rendition.annotations.remove(h.position.cfi, "highlight");
    };
  }, [rendition, highlights]);

  function handleConfirm(color: HighlightColor, note: string) {
    if (!pending) return;
    onCreateHighlight(pending.cfiRange, pending.selectedText, color, note);
    setPending(null);
    // epubjs's type declares getContents(): Contents, but the real
    // implementation (rendition.js) returns Contents[] -- one per
    // currently-rendered iframe.
    (rendition?.getContents() as unknown as Contents[] | undefined)?.forEach((c) => c.window.getSelection()?.removeAllRanges());
  }

  if (loadError) {
    return <p className="rounded-md border border-dashed border-border px-5 py-8 text-center font-sans text-sm text-ink-muted">{loadError}</p>;
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-center gap-4 font-sans text-sm text-ink-muted">
        <button
          type="button"
          onClick={() => rendition?.prev()}
          className="rounded-sm px-2 py-1 hover:bg-surface-2"
        >
          ← Prev
        </button>
        <span>{locationLabel || "Loading…"}</span>
        <button
          type="button"
          onClick={() => rendition?.next()}
          className="rounded-sm px-2 py-1 hover:bg-surface-2"
        >
          Next →
        </button>
      </div>

      <div ref={viewerRef} data-epub-reader style={{ height: "70vh" }} />

      {pending && (
        <HighlightPopover
          anchorRect={pending.rect}
          selectedText={pending.selectedText}
          onConfirm={handleConfirm}
          onDismiss={() => setPending(null)}
        />
      )}
      {managing && (
        <HighlightManagePopover
          anchorRect={managing.rect}
          noteText={managing.highlight.annotation?.noteText ?? ""}
          onSaveNote={(text) => {
            onSaveNote(managing.highlight.id, text);
            setManaging(null);
          }}
          onDeleteNote={() => {
            onDeleteNote(managing.highlight.id);
            setManaging(null);
          }}
          onDeleteHighlight={() => {
            onDeleteHighlight(managing.highlight.id);
            setManaging(null);
          }}
          onDismiss={() => setManaging(null)}
        />
      )}
    </div>
  );
}
