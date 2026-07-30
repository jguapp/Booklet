"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, TextLayer } from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, PageViewport, RenderTask } from "pdfjs-dist";
import type { Highlight, HighlightColor, PdfPosition, PdfRect } from "@booklet/shared";
import { highlightColorRgba } from "@booklet/shared";
import { HighlightPopover } from "./highlight-popover";
import { HighlightManagePopover } from "./highlight-manage-popover";
import styles from "./pdf-reader.module.css";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const CONTEXT_LENGTH = 32;
// Canvas fills, unlike CSS classes, can't reference the theme-aware
// --color-highlight-* custom properties -- these were always a fixed
// (light-theme-matching) rgba regardless of reading theme, same as now.
const HIGHLIGHT_FILL_ALPHA = 0.55;
// How far outside the viewport (in px) a page in scroll mode starts
// rendering before it's actually visible -- smooths scrolling by avoiding a
// visible pop-in right at the viewport edge.
const SCROLL_RENDER_MARGIN_PX = 800;

interface PdfReaderProps {
  fileBlob: Blob;
  highlights: Highlight[];
  initialProgressFraction: number;
  onProgressChange: (fraction: number) => void;
  /** The current page's plain text, for read-aloud -- re-reported whenever
   * the "current" page changes (a page turn in paginate mode, or whichever
   * page is most in view in scroll mode). */
  onPageTextChange?: (text: string) => void;
  onCreateHighlight: (position: PdfPosition, color: HighlightColor, note: string) => void;
  onDeleteHighlight: (highlightId: string) => void;
  onSaveNote: (highlightId: string, noteText: string) => void;
  onDeleteNote: (highlightId: string) => void;
  /** "paginate" (Prev/Next, one page at a time) or "scroll" (continuously
   * scroll through pages) -- see device-prefs.ts's pdfReadingMode. */
  readingMode: "paginate" | "scroll";
  /** Set (with a fresh nonce, so re-clicking the same target re-triggers)
   * to navigate to a page from outside -- e.g. the Notebook panel's
   * highlights list. */
  jumpToPage?: { page: number; nonce: number } | null;
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
  onPageTextChange,
  onCreateHighlight,
  onDeleteHighlight,
  onSaveNote,
  onDeleteNote,
  readingMode,
  jumpToPage,
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
  const onPageTextChangeRef = useRef(onPageTextChange);
  useEffect(() => {
    initialProgressRef.current = initialProgressFraction;
    onProgressChangeRef.current = onProgressChange;
    onPageTextChangeRef.current = onPageTextChange;
  }, [initialProgressFraction, onProgressChange, onPageTextChange]);

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
  // that positioning depends on). Paginate mode only -- scroll mode's
  // per-page rendering lives in PdfScrollPageSlot below.
  useEffect(() => {
    if (readingMode !== "paginate") return;
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
  }, [readingMode, doc, pageNumber]);

  useEffect(() => {
    if (readingMode !== "paginate") return;
    if (numPages <= 1) return;
    onProgressChangeRef.current((pageNumber - 1) / (numPages - 1));
  }, [readingMode, pageNumber, numPages]);

  useEffect(() => {
    if (readingMode !== "paginate") return;
    onPageTextChangeRef.current?.(pageText);
  }, [readingMode, pageText]);

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

  // ---- Scroll mode ----
  // Renders every page in a vertical stack instead of one at a time.
  // Pages are lazy: a page only gets its canvas + text layer rendered once
  // it scrolls near the viewport (tracked by one shared IntersectionObserver
  // below, not per-page), so opening a long PDF doesn't eagerly rasterize
  // every page up front. Rendered pages are never un-rendered once scrolled
  // back out of view (a fuller LRU-style eviction would bound memory more
  // tightly for very long documents, but adds real complexity/risk for a
  // case real-world PDFs -- articles, books -- rarely hit).
  const [scrollRenderedPages, setScrollRenderedPages] = useState<Set<number>>(new Set());
  const [currentScrollPage, setCurrentScrollPage] = useState(1);
  const [pageAspect, setPageAspect] = useState<{ width: number; height: number } | null>(null);
  const scrollSlotElsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollObserverRef = useRef<IntersectionObserver | null>(null);
  const scrollPageTextRef = useRef<Map<number, string>>(new Map());
  const currentScrollPageRef = useRef(1);
  const hasScrolledToResumeRef = useRef(false);

  const highlightsByPage = useMemo(() => {
    const map = new Map<number, (Highlight & { position: PdfPosition })[]>();
    for (const h of highlights) {
      if (!isPdfHighlight(h)) continue;
      const list = map.get(h.position.pageNumber);
      if (list) list.push(h);
      else map.set(h.position.pageNumber, [h]);
    }
    return map;
  }, [highlights]);

  // Page 1's unscaled dimensions, used to size every not-yet-rendered
  // page's placeholder -- real-world PDFs are near-universally uniform
  // page size, so this is a good estimate that avoids needing to open
  // every page just to lay out its placeholder.
  useEffect(() => {
    if (readingMode !== "scroll" || !doc) return;
    let cancelled = false;
    doc.getPage(1).then((page) => {
      if (cancelled) return;
      const vp = page.getViewport({ scale: 1 });
      setPageAspect({ width: vp.width, height: vp.height });
    });
    return () => {
      cancelled = true;
    };
  }, [readingMode, doc]);

  // Reset scroll-mode state whenever a new document loads -- adjusted
  // during render (React's documented pattern for "reset state when a prop
  // changes") rather than in an effect, which would cause an extra
  // cascading render for state that's cheap to compute up front. Refs
  // can't be touched here too (also render-impure) -- those are mirrored
  // separately below.
  const [scrollStateDoc, setScrollStateDoc] = useState<PDFDocumentProxy | null>(null);
  if (readingMode === "scroll" && doc && doc !== scrollStateDoc) {
    setScrollStateDoc(doc);
    setScrollRenderedPages(new Set());
    setCurrentScrollPage(pageNumber);
  }

  // Ref mirrors of state above, plus imperative-only bookkeeping -- refs
  // are fine to write from an effect (unlike setState), this just needs to
  // happen in the same commit as the reset above.
  useEffect(() => {
    currentScrollPageRef.current = currentScrollPage;
  }, [currentScrollPage]);
  useEffect(() => {
    scrollPageTextRef.current = new Map();
    hasScrolledToResumeRef.current = false;
  }, [scrollStateDoc]);

  // One shared IntersectionObserver for every page slot -- both decides
  // which pages are "near enough to render" (rootMargin extends the
  // trigger zone past the actual viewport, so a page starts rendering
  // slightly before it's visible) and, among currently-intersecting pages,
  // which one is "current" for progress/TTS (whichever has the largest
  // share of the viewport actually filled by it -- NOT whichever's top
  // edge is closest to 0, which sounds equivalent but isn't: a page
  // scrolled to a top of -0.5px from sub-pixel rounding would lose to the
  // next page down every time under a top-distance comparison, even
  // though it still fills nearly the entire viewport).
  useEffect(() => {
    if (readingMode !== "scroll" || !doc || numPages === 0) return;

    const intersecting = new Map<number, number>(); // pageNumber -> intersectionRatio

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = entry.target as HTMLElement;
          const entryPageNumber = Number(target.dataset.pdfScrollPage);
          if (!entryPageNumber) continue;
          if (entry.isIntersecting) intersecting.set(entryPageNumber, entry.intersectionRatio);
          else intersecting.delete(entryPageNumber);
        }

        // Additive only -- a page that has started rendering stays
        // rendered even after it scrolls back out of the margin (see the
        // "Scroll mode" scope note above), so this can only grow, never
        // shrink, `intersecting`'s own key set.
        setScrollRenderedPages((prev) => {
          let changed = false;
          const next = new Set(prev);
          for (const p of intersecting.keys()) {
            if (!next.has(p)) {
              next.add(p);
              changed = true;
            }
          }
          return changed ? next : prev;
        });

        let best: { pageNumber: number; ratio: number } | null = null;
        for (const [entryPageNumber, ratio] of intersecting) {
          if (best === null || ratio > best.ratio) best = { pageNumber: entryPageNumber, ratio };
        }
        if (best) {
          setCurrentScrollPage(best.pageNumber);
          currentScrollPageRef.current = best.pageNumber;
        }
      },
      {
        root: null,
        rootMargin: `${SCROLL_RENDER_MARGIN_PX}px 0px`,
        // Dense thresholds -- intersectionRatio needs to be a meaningful,
        // frequently-updated signal to pick "most visible" correctly, not
        // just fire once at a couple of coarse crossing points.
        threshold: Array.from({ length: 21 }, (_, i) => i / 20),
      },
    );
    scrollObserverRef.current = observer;
    for (const el of scrollSlotElsRef.current.values()) observer.observe(el);

    return () => {
      observer.disconnect();
      scrollObserverRef.current = null;
    };
  }, [readingMode, doc, numPages]);

  const registerScrollSlotEl = useCallback((slotPageNumber: number, el: HTMLDivElement | null) => {
    const map = scrollSlotElsRef.current;
    const existing = map.get(slotPageNumber);
    if (existing && scrollObserverRef.current) scrollObserverRef.current.unobserve(existing);
    if (el) {
      map.set(slotPageNumber, el);
      scrollObserverRef.current?.observe(el);
      // Scroll to the resume position once (the target slot needs to
      // already be in the DOM, with its estimated-aspect placeholder
      // height, for this to land close to the right spot).
      if (!hasScrolledToResumeRef.current && slotPageNumber === pageNumber && pageNumber > 1) {
        hasScrolledToResumeRef.current = true;
        el.scrollIntoView({ block: "start" });
      }
    } else {
      map.delete(slotPageNumber);
    }
  }, [pageNumber]);

  // Jump to a page from outside (the Notebook panel's highlights list) --
  // paginate mode just switches pages, adjusted during render (React's
  // documented pattern for reacting to a prop change with a state update)
  // rather than in an effect. Scroll mode instead scrolls that page's slot
  // into view (reusing the same ref every page-slot already registers
  // itself into for the IntersectionObserver above) -- a real DOM
  // operation, not a state update, so it stays in a plain effect below.
  const [handledJumpNonce, setHandledJumpNonce] = useState<number | null>(null);
  if (jumpToPage && jumpToPage.nonce !== handledJumpNonce && doc && numPages > 0 && readingMode === "paginate") {
    setHandledJumpNonce(jumpToPage.nonce);
    setPageNumber(Math.min(numPages, Math.max(1, jumpToPage.page)));
  }

  useEffect(() => {
    if (!jumpToPage || !doc || numPages === 0 || readingMode !== "scroll") return;
    const target = Math.min(numPages, Math.max(1, jumpToPage.page));
    scrollSlotElsRef.current.get(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [jumpToPage, doc, numPages, readingMode]);

  useEffect(() => {
    if (readingMode !== "scroll") return;
    if (numPages <= 1) return;
    onProgressChangeRef.current((currentScrollPage - 1) / (numPages - 1));
  }, [readingMode, currentScrollPage, numPages]);

  const handleScrollPageTextChange = useCallback((slotPageNumber: number, text: string) => {
    scrollPageTextRef.current.set(slotPageNumber, text);
    if (slotPageNumber === currentScrollPageRef.current) onPageTextChangeRef.current?.(text);
  }, []);

  useEffect(() => {
    if (readingMode !== "scroll") return;
    const text = scrollPageTextRef.current.get(currentScrollPage);
    if (text !== undefined) onPageTextChangeRef.current?.(text);
  }, [readingMode, currentScrollPage]);

  if (loadError) {
    return <p className="rounded-md border border-dashed border-border px-5 py-8 text-center font-sans text-sm text-ink-muted">{loadError}</p>;
  }

  if (!doc) {
    return <p className="py-8 text-center font-sans text-sm text-ink-faint">Loading PDF…</p>;
  }

  if (readingMode === "scroll") {
    return (
      <div>
        <div data-pdf-page-indicator className="mb-4 text-center font-sans text-sm text-ink-muted">
          Page {currentScrollPage} of {numPages}
        </div>
        <div className="flex flex-col items-center gap-3">
          {Array.from({ length: numPages }, (_, i) => i + 1).map((slotPageNumber) => (
            <PdfScrollPageSlot
              key={slotPageNumber}
              doc={doc}
              pageNumber={slotPageNumber}
              shouldRender={scrollRenderedPages.has(slotPageNumber)}
              estimatedAspect={pageAspect}
              highlights={highlightsByPage.get(slotPageNumber) ?? []}
              registerEl={registerScrollSlotEl}
              onTextChange={handleScrollPageTextChange}
              onPendingSelection={setPending}
              onManaging={setManaging}
            />
          ))}
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
        <span data-pdf-page-indicator>
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
                      backgroundColor: highlightColorRgba(h.color, HIGHLIGHT_FILL_ALPHA),
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

interface PdfScrollPageSlotProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  /** Set by the parent's shared IntersectionObserver once this page is
   * near the viewport -- renders its canvas + text layer for the first
   * time when this flips true, and never un-renders afterward (see the
   * scope note on the "Scroll mode" section above). */
  shouldRender: boolean;
  /** Page 1's aspect ratio, for sizing this slot's placeholder before it
   * has rendered (and thus doesn't have its own real viewport yet). */
  estimatedAspect: { width: number; height: number } | null;
  highlights: (Highlight & { position: PdfPosition })[];
  registerEl: (pageNumber: number, el: HTMLDivElement | null) => void;
  onTextChange: (pageNumber: number, text: string) => void;
  onPendingSelection: (pending: PendingSelection) => void;
  onManaging: (managing: ManagingHighlight) => void;
}

function PdfScrollPageSlot({
  doc,
  pageNumber,
  shouldRender,
  estimatedAspect,
  highlights,
  registerEl,
  onTextChange,
  onPendingSelection,
  onManaging,
}: PdfScrollPageSlotProps) {
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [rendered, setRendered] = useState(false);
  const [pageText, setPageText] = useState("");

  const pageContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const onTextChangeRef = useRef(onTextChange);
  useEffect(() => {
    onTextChangeRef.current = onTextChange;
  }, [onTextChange]);

  useEffect(() => {
    if (!shouldRender || rendered) return;
    let cancelled = false;

    async function renderPage() {
      const page = await doc.getPage(pageNumber);
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
        const text = textContent.items.map((item) => ("str" in item ? item.str : "")).join(" ");
        setPageText(text);
        onTextChangeRef.current(pageNumber, text);
      }
      if (!cancelled) setRendered(true);
    }

    renderPage();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [shouldRender, rendered, doc, pageNumber]);

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
    onPendingSelection({ position, rect: range.getBoundingClientRect() });
  }

  return (
    <div
      ref={(el) => {
        pageContainerRef.current = el;
        registerEl(pageNumber, el);
      }}
      data-pdf-scroll-page={pageNumber}
      data-pdf-rendered={viewport ? "true" : "false"}
      data-pdf-reader
      className={styles.page}
      style={
        {
          "--scale-factor": viewport?.scale ?? 1,
          width: viewport ? viewport.width : "100%",
          height: viewport?.height,
          aspectRatio: !viewport && estimatedAspect ? `${estimatedAspect.width} / ${estimatedAspect.height}` : undefined,
        } as React.CSSProperties
      }
      onMouseUp={handleMouseUp}
    >
      {/*
       * canvasRef/textLayerRef must always be mounted (not gated on
       * `viewport`, which is set *by* the render effect that reads these
       * refs) -- same bug/fix as the paginate-mode block above: gating on
       * `viewport` would mean the refs are still null the first time the
       * effect runs, silently aborting the render before it ever paints
       * anything or builds a text layer.
       */}
      <div className={styles.canvasWrapper}>
        <canvas ref={canvasRef} />
      </div>
      <div ref={textLayerRef} className={styles.textLayer} />
      <div className={styles.highlightOverlay}>
        {viewport &&
          highlights.map((h) =>
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
                  onClick={(e) => onManaging({ highlight: h, rect: (e.target as HTMLElement).getBoundingClientRect() })}
                  style={{
                    position: "absolute",
                    left,
                    top,
                    width: Math.abs(vx2 - vx1),
                    height: Math.abs(vy2 - vy1),
                    backgroundColor: highlightColorRgba(h.color, HIGHLIGHT_FILL_ALPHA),
                    cursor: "pointer",
                    pointerEvents: "auto",
                  }}
                />
              );
            }),
          )}
      </div>
      {!viewport && (
        <div className="absolute inset-0 flex items-center justify-center font-sans text-xs text-ink-faint">
          Page {pageNumber}
        </div>
      )}
    </div>
  );
}
