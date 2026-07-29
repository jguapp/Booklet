"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, TextLayer } from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, PageViewport, RenderTask } from "pdfjs-dist";
import type { Highlight, HighlightColor, PdfPosition, PdfRect } from "@booklet/shared";
import { HighlightPopover } from "./highlight-popover";
import { HighlightManagePopover } from "./highlight-manage-popover";
import styles from "./pdf-reader.module.css";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const CONTEXT_LENGTH = 32;
const HIGHLIGHT_FILL: Record<HighlightColor, string> = {
  YELLOW: "rgba(243, 222, 156, 0.55)",
  GREEN: "rgba(188, 223, 196, 0.55)",
  BLUE: "rgba(187, 214, 232, 0.55)",
  PINK: "rgba(239, 204, 218, 0.55)",
  ORANGE: "rgba(241, 203, 158, 0.55)",
};

interface PdfReaderProps {
  fileBlob: Blob;
  highlights: Highlight[];
  initialProgressFraction: number;
  onProgressChange: (fraction: number) => void;
  onCreateHighlight: (position: PdfPosition, color: HighlightColor, note: string) => void;
  onDeleteHighlight: (highlightId: string) => void;
  onSaveNote: (highlightId: string, noteText: string) => void;
  onDeleteNote: (highlightId: string) => void;
}

interface PendingSelection {
  position: PdfPosition;
  rect: DOMRect;
}

interface ManagingHighlight {
  highlight: Highlight;
  rect: DOMRect;
}

function isPdfHighlight(h: Highlight): h is Highlight & { position: PdfPosition } {
  return h.position.type === "pdf";
}

// Surrounding-context slice for re-search, same shape as
// packages/shared/highlight-anchor.ts's computeTextPosition -- rects are
// the real anchor for a PDF highlight (an uploaded file never drifts the
// way re-extracted HTML can), this is only a fallback aid.
function contextAround(pageText: string, selected: string): { prefix: string; suffix: string } {
  const idx = pageText.indexOf(selected);
  if (idx === -1) return { prefix: "", suffix: "" };
  return {
    prefix: pageText.slice(Math.max(0, idx - CONTEXT_LENGTH), idx),
    suffix: pageText.slice(idx + selected.length, idx + selected.length + CONTEXT_LENGTH),
  };
}

export function PdfReader({
  fileBlob,
  highlights,
  initialProgressFraction,
  onProgressChange,
  onCreateHighlight,
  onDeleteHighlight,
  onSaveNote,
  onDeleteNote,
}: PdfReaderProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [pageText, setPageText] = useState("");
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [managing, setManaging] = useState<ManagingHighlight | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const pageContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  // initialProgressFraction only matters once, right when a document
  // finishes loading (to pick the starting page) -- read via ref rather
  // than as an effect dependency so a page turn (which changes the "real"
  // current fraction upstream) doesn't fight the reader by resetting it.
  const initialProgressRef = useRef(initialProgressFraction);
  const onProgressChangeRef = useRef(onProgressChange);
  useEffect(() => {
    initialProgressRef.current = initialProgressFraction;
    onProgressChangeRef.current = onProgressChange;
  }, [initialProgressFraction, onProgressChange]);

  // Load the document once per file. A local (IndexedDB) file and an
  // authenticated (server) file both arrive as a Blob either way -- see
  // lib/data/articles.ts's loadArticleFile -- so this doesn't care which.
  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      setDoc(null);
      setLoadError(null);
      try {
        const data = await fileBlob.arrayBuffer();
        const loaded = await getDocument({ data }).promise;
        if (cancelled) return;
        setDoc(loaded);
        setNumPages(loaded.numPages);
        const resumeFraction = initialProgressRef.current;
        const startPage =
          resumeFraction > 0 ? Math.min(loaded.numPages, Math.round(resumeFraction * (loaded.numPages - 1)) + 1) : 1;
        setPageNumber(startPage);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Couldn't open this PDF.");
      }
    }

    loadPdf();
    return () => {
      cancelled = true;
    };
  }, [fileBlob]);

  // Render the current page: canvas (visible glyphs) + text layer
  // (invisible, selectable spans precisely positioned by pdfjs's own
  // TextLayer over those glyphs -- see pdf-reader.module.css for the CSS
  // that positioning depends on).
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let page: PDFPageProxy | null = null;

    async function renderPage() {
      page = await doc!.getPage(pageNumber);
      if (cancelled) return;

      const containerWidth = pageContainerRef.current?.clientWidth ?? 700;
      const unscaled = page.getViewport({ scale: 1 });
      const scale = containerWidth / unscaled.width;
      const pageViewport = page.getViewport({ scale });
      if (cancelled) return;
      setViewport(pageViewport);

      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = pageViewport.width;
      canvas.height = pageViewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      renderTaskRef.current?.cancel();
      const task = page.render({ canvasContext: ctx, viewport: pageViewport, canvas });
      renderTaskRef.current = task;
      await task.promise.catch(() => undefined); // a superseded render is cancelled, not an error
      if (cancelled) return;

      const textLayerEl = textLayerRef.current;
      if (textLayerEl) {
        textLayerEl.replaceChildren();
        const textContent = await page.getTextContent();
        if (cancelled) return;
        await new TextLayer({ textContentSource: textContent, container: textLayerEl, viewport: pageViewport }).render();
        setPageText(
          textContent.items.map((item) => ("str" in item ? item.str : "")).join(" "),
        );
      }
    }

    renderPage();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [doc, pageNumber]);

  useEffect(() => {
    if (numPages <= 1) return;
    onProgressChangeRef.current((pageNumber - 1) / (numPages - 1));
  }, [pageNumber, numPages]);

  function handleMouseUp() {
    const selection = window.getSelection();
    const container = textLayerRef.current;
    const pageEl = pageContainerRef.current;
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !container || !pageEl || !viewport) return;

    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;

    const selectedText = range.toString().trim();
    if (!selectedText) return;

    const pageRect = pageEl.getBoundingClientRect();
    const clientRects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    if (clientRects.length === 0) return;

    const rects: PdfRect[] = clientRects.map((r) => {
      const [px1, py1] = viewport.convertToPdfPoint(r.left - pageRect.left, r.top - pageRect.top);
      const [px2, py2] = viewport.convertToPdfPoint(r.right - pageRect.left, r.bottom - pageRect.top);
      return { x: Math.min(px1, px2), y: Math.min(py1, py2), width: Math.abs(px2 - px1), height: Math.abs(py2 - py1) };
    });

    const { prefix, suffix } = contextAround(pageText, selectedText);
    const position: PdfPosition = { type: "pdf", pageNumber, text: selectedText, prefix, suffix, rects };
    setPending({ position, rect: range.getBoundingClientRect() });
  }

  function handleConfirm(color: HighlightColor, note: string) {
    if (!pending) return;
    onCreateHighlight(pending.position, color, note);
    setPending(null);
    window.getSelection()?.removeAllRanges();
  }

  const pageHighlights = useMemo(
    () => highlights.filter(isPdfHighlight).filter((h) => h.position.pageNumber === pageNumber),
    [highlights, pageNumber],
  );

  if (loadError) {
    return <p className="rounded-md border border-dashed border-border px-5 py-8 text-center font-sans text-sm text-ink-muted">{loadError}</p>;
  }

  if (!doc) {
    return <p className="py-8 text-center font-sans text-sm text-ink-faint">Loading PDF…</p>;
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-center gap-4 font-sans text-sm text-ink-muted">
        <button
          type="button"
          onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
          disabled={pageNumber <= 1}
          className="rounded-sm px-2 py-1 hover:bg-surface-2 disabled:opacity-40"
        >
          ← Prev
        </button>
        <span>
          Page {pageNumber} of {numPages}
        </span>
        <button
          type="button"
          onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
          disabled={pageNumber >= numPages}
          className="rounded-sm px-2 py-1 hover:bg-surface-2 disabled:opacity-40"
        >
          Next →
        </button>
      </div>

      {/*
       * Always mounted once `doc` exists -- canvasRef/textLayerRef/
       * pageContainerRef must already point at real DOM nodes by the time
       * the page-render effect (keyed on [doc, pageNumber]) runs, which
       * happens right after this commits. Gating this whole block on
       * `viewport` too (viewport is set *by* that same effect) would mean
       * the refs are still null on the very first render -- exactly the
       * bug this comment is here to stop someone from reintroducing.
       */}
      <div
        ref={pageContainerRef}
        data-pdf-reader
        className={styles.page}
        style={
          {
            "--scale-factor": viewport?.scale ?? 1,
            width: viewport ? viewport.width : "100%",
            height: viewport?.height,
          } as React.CSSProperties
        }
        onMouseUp={handleMouseUp}
      >
        <div className={styles.canvasWrapper}>
          <canvas ref={canvasRef} />
        </div>
        <div ref={textLayerRef} className={styles.textLayer} />
        <div className={styles.highlightOverlay}>
          {viewport &&
            pageHighlights.map((h) =>
              h.position.rects.map((rect, i) => {
                const [vx1, vy1] = viewport.convertToViewportPoint(rect.x, rect.y);
                const [vx2, vy2] = viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height);
                const left = Math.min(vx1, vx2);
                const top = Math.min(vy1, vy2);
                return (
                  <div
                    key={`${h.id}-${i}`}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => setManaging({ highlight: h, rect: (e.target as HTMLElement).getBoundingClientRect() })}
                    style={{
                      position: "absolute",
                      left,
                      top,
                      width: Math.abs(vx2 - vx1),
                      height: Math.abs(vy2 - vy1),
                      backgroundColor: HIGHLIGHT_FILL[h.color],
                      cursor: "pointer",
                      pointerEvents: "auto",
                    }}
                  />
                );
              }),
            )}
        </div>
      </div>

      {pending && (
        <HighlightPopover
          anchorRect={pending.rect}
          selectedText={pending.position.text}
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
