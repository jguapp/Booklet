"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Article, ArticleStatus, Highlight, HighlightColor, HighlightPosition } from "@booklet/shared";
import { computeRelatedArticles } from "@booklet/shared";
import { useTheme } from "@/lib/theme/theme-provider";
import {
  loadArticle,
  loadArticleFile,
  loadArticles,
  sendArticleToKindle,
  updateArticleProgress,
  updateArticleStatus,
} from "@/lib/data/articles";
import { createHighlight, deleteHighlight, deleteNote, loadHighlights, saveNote } from "@/lib/data/highlights";
import { useAuth } from "@/lib/auth/auth-provider";
import { useToast } from "@/lib/toast/toast-provider";
import { ApiError } from "@/lib/api/client";
import { formatMinutesLeft, formatReadingTime } from "@/lib/format";
import { textToParagraphHtml } from "@/lib/reader/text-to-html";
import { useDevicePrefs } from "@/lib/data/device-prefs-provider";
import { ReaderToolbar } from "./reader-toolbar";
import { ReaderProgressBar } from "./reader-progress-bar";
import { NotebookPanel } from "./notebook-panel";
import { ArticleContent } from "./article-content";

// pdf.js and epub.js are both real weight (canvas rendering, a full zip/
// EPUB parser) that only the minority of reader views opening a PDF/EPUB
// ever need -- a plain static import bundled both into every reader page
// load regardless of sourceType, including the common HTML-article case
// that never touches either. next/dynamic + ssr:false (both rely on
// browser-only APIs -- Canvas, DOM -- so there's no server-rendered
// version to lose) defers actually loading each one's JS until a reader
// of that specific kind is about to mount.
const PdfReader = dynamic(() => import("./pdf-reader").then((m) => m.PdfReader), {
  ssr: false,
  loading: () => <p className="py-8 text-center font-sans text-sm text-ink-faint">Loading PDF…</p>,
});
const EpubReader = dynamic(() => import("./epub-reader").then((m) => m.EpubReader), {
  ssr: false,
  loading: () => <p className="py-8 text-center font-sans text-sm text-ink-faint">Loading EPUB…</p>,
});
import { TtsControls } from "./tts-controls";
import { useTtsPlayer } from "@/lib/reader/tts-player-provider";
import { TagEditor } from "@/components/library/tag-editor";
import { SourceIcon } from "@/components/library/source-icon";
import { HighlightListItem } from "@/components/highlights/highlight-list-item";
import { IconBook } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

const STATUS_TABS: { value: ArticleStatus; label: string }[] = [
  { value: "UNREAD", label: "Unread" },
  { value: "READING", label: "Reading" },
  { value: "ARCHIVED", label: "Archived" },
];

const PROGRESS_SAVE_INTERVAL_MS = 4000;
const PROGRESS_CHANGE_THRESHOLD = 0.01; // don't write on every hair's-width of scroll
const AUTO_READ_PROGRESS_THRESHOLD = 0.98; // PDF hits exactly 1 on its last page; HTML scroll and EPUB locations can fall just short

export function ReaderView({ articleId }: { articleId: string }) {
  const { theme, setTheme } = useTheme();
  const { status: authStatus, isAuthenticated } = useAuth();
  const { reader, setReaderSize } = useDevicePrefs();
  const size = reader.size;
  const { toast } = useToast();
  const [sendingToKindle, setSendingToKindle] = useState(false);
  const [article, setArticle] = useState<Article | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [progress, setProgress] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [fileBlob, setFileBlob] = useState<Blob | null>(null);
  const [fileLoadStatus, setFileLoadStatus] = useState<"idle" | "loading" | "loaded" | "failed">("idle");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [pdfPageText, setPdfPageText] = useState("");
  const [epubSectionText, setEpubSectionText] = useState("");
  const [relatedArticles, setRelatedArticles] = useState<{ articleId: string; articles: Article[] } | null>(null);
  // Notebook panel -- closed by default each time a reader is opened
  // (not a persisted device pref, unlike showProgressBar/pdfReadingMode --
  // it's a per-session "peek at my highlights" toggle, not a standing
  // reading preference).
  const [showNotebook, setShowNotebook] = useState(false);
  const [jumpToPdfPage, setJumpToPdfPage] = useState<{ page: number; nonce: number } | null>(null);
  const [jumpToEpubCfi, setJumpToEpubCfi] = useState<{ cfi: string; nonce: number } | null>(null);

  // Which reader is actually rendering this article -- PDF/EPUB get their
  // own real readers (pdf-reader.tsx, epub-reader.tsx) once the file's
  // loaded; everything else (including a PDF/EPUB whose file failed to
  // load) falls back to the extracted-text-through-the-HTML-highlighter
  // path. Computed once, up here (not after the !article early return
  // below), since it's needed both by hooks that must run unconditionally
  // (the scroll-progress listener right below) and by `readableText`
  // (what "read aloud" sends to the global TtsPlayerProvider, see below)
  // and the render logic at the bottom of this component.
  const usesPdfReader = article?.sourceType === "PDF" && fileBlob !== null;
  const usesEpubReader = article?.sourceType === "EPUB" && fileBlob !== null;
  // True for the gap between "we know this is a PDF/EPUB" and "the real
  // file has loaded (or definitively failed to)" -- distinct from a genuine
  // load failure, which still needs to fall through to the extracted-text
  // view below. Without this, that same fallback renders during the gap
  // too, indistinguishable from "this is all there is" even though the real
  // file is just still downloading/parsing.
  const isFileLoadPending =
    (article?.sourceType === "PDF" || article?.sourceType === "EPUB") && fileLoadStatus === "loading";

  const refresh = useCallback(() => {
    if (authStatus === "loading") return;
    Promise.all([loadArticle(articleId, isAuthenticated), loadHighlights(isAuthenticated, articleId)]).then(
      ([a, h]) => {
        setArticle(a);
        setHighlights(h);
        setLoaded(true);
      },
    );
  }, [authStatus, isAuthenticated, articleId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The raw file backs both the real PDF/EPUB readers and the "download
  // original" link. Local (no-account) mode reads it straight from
  // IndexedDB; authenticated mode's file lives behind an auth-gated route
  // (GET /api/articles/:id/file) that a plain <a href> can't send a Bearer
  // token to, so loadArticleFile fetches it as a Blob either way -- see
  // lib/data/articles.ts.
  //
  // Keyed on the whole `article` object, so it re-fires on *any* article
  // update -- a tag edit, a status change -- not just an actual file change.
  // A fresh fileBlob reference then trips PdfReader/EpubReader's own
  // doc-loading effect (keyed on `fileBlob`), which resets back to page 1 /
  // the first location. loadedFileKeyRef skips the refetch (and the
  // resulting reset) unless the file identity actually changed.
  // Keyed on articleId (a prop, known synchronously from the route) and
  // isAuthenticated -- deliberately *not* on the `article` metadata object,
  // even though this file only actually matters for a PDF/EPUB article.
  // Waiting for metadata to resolve first before even starting the file
  // request turned "open a PDF" into a real waterfall: fetch metadata,
  // wait for that round trip, *then* start fetching the (often much
  // bigger) file -- a full extra RTT of dead time before a large file even
  // starts downloading, on top of its own transfer time. Firing both
  // requests together instead means the file is already partway
  // downloaded (or done, for a small one) by the time metadata confirms
  // this is even a PDF/EPUB. The cost: every *non*-PDF/EPUB article now
  // also fires one throwaway request here -- cheap and harmless, since the
  // server 404s it off a plain existence check with no file I/O (see
  // articles.ts's /file route), and isFileLoadPending/usesPdfReader below
  // are already gated on article.sourceType, so a "failed" status from
  // that 404 never surfaces as a PDF/EPUB load error for an HTML article.
  const loadedFileKeyRef = useRef<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;

    async function loadFile() {
      const key = `${articleId}:${isAuthenticated}`;
      if (key === loadedFileKeyRef.current) return;
      loadedFileKeyRef.current = key;
      setFileLoadStatus("loading");
      const blob = await loadArticleFile(articleId, isAuthenticated).catch(() => null);
      // Checked against the ref, not a boolean flipped by this closure's
      // own cleanup -- isAuthenticated can genuinely settle through more
      // than one value right after sign-up/sign-in, which re-runs this
      // effect more than once even though it lands back on the same real
      // key. A plain "cancelled on any re-run" flag discarded an
      // already-successful fetch on that second, same-key run with
      // nothing left to replace it -- confirmed by hand this is exactly
      // what got a freshly-opened PDF/EPUB stuck on "loading the original
      // file..." forever, with the file already sitting in the browser's
      // memory the whole time. Comparing against the ref instead only
      // discards a result once something *actually newer* (a real
      // articleId/isAuthenticated change) has superseded it.
      if (loadedFileKeyRef.current !== key) return;
      if (!blob) {
        // Also clears any previous article's blob -- SPA navigation
        // between two reader pages reuses this same component instance
        // (see the file header comment), so without this a PDF's blob
        // would otherwise linger in state after navigating to an HTML
        // article that has no file of its own.
        setFileBlob(null);
        setDownloadUrl(null);
        setFileLoadStatus("failed");
        return;
      }
      setFileBlob(blob);
      setFileLoadStatus("loaded");
      objectUrl = URL.createObjectURL(blob);
      setDownloadUrl(objectUrl);
    }

    loadFile();
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [articleId, isAuthenticated]);

  // latestProgressRef is the single feed for all three reader kinds (HTML
  // scroll fraction, PDF page/numPages, EPUB book.locations percentage) --
  // whoever's actually rendering just reports into it, and one periodic
  // timer below (not each reader) is responsible for persisting it. articleRef
  // exists so that timer doesn't need `article` in its own dependency array
  // (every unrelated field update -- status, tags, a new highlight -- creates
  // a new article object, which would otherwise restart the save interval).
  const latestProgressRef = useRef(0);
  const articleRef = useRef<Article | null>(null);
  useEffect(() => {
    articleRef.current = article;
  }, [article]);

  // Window-scroll-fraction progress only makes sense for the plain-HTML
  // reader path -- PDF (page/numPages) and EPUB (book.locations
  // percentage) report their own real progress via handleProgressChange
  // below. This listener used to be unconditional, which meant *any*
  // incidental window scroll while a PDF/EPUB reader was mounted (the page
  // container being taller than the viewport, a highlight popover
  // shifting layout) would clobber that reader's correct progress with a
  // value computed from unrelated document scroll geometry -- the actual
  // cause of both an EPUB getting auto-archived after only a few pages
  // (stray scroll pushed the shared fraction near 1.0) and a PDF's
  // progress never updating from page-turns alone (stray scroll kept
  // overwriting it back down).
  useEffect(() => {
    if (usesPdfReader || usesEpubReader) return;
    function handleScroll() {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      const fraction = scrollable > 0 ? Math.min(1, Math.max(0, doc.scrollTop / scrollable)) : 0;
      setProgress(fraction);
      latestProgressRef.current = fraction;
    }
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [usesPdfReader, usesEpubReader]);

  function handleProgressChange(fraction: number) {
    setProgress(fraction);
    latestProgressRef.current = fraction;
  }

  // Resume scroll position once, after the article (and its text-mode
  // content) has actually rendered -- PDF/EPUB resume themselves, using
  // article.progressFraction directly (page number / locations percentage
  // respectively), since "scroll the window" doesn't mean anything for them.
  const hasResumedScrollRef = useRef(false);
  useEffect(() => {
    if (hasResumedScrollRef.current || !article || article.progressFraction <= 0) return;
    if (article.sourceType !== "HTML" && !article.extractedHtml) return; // extracted-text fallback path: same idea, still scroll-based
    hasResumedScrollRef.current = true;
    const id = requestAnimationFrame(() => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      if (scrollable > 0) window.scrollTo({ top: scrollable * article.progressFraction });
    });
    return () => cancelAnimationFrame(id);
  }, [article]);

  // Periodic flush, flush-on-unmount (an in-app Link navigation), and
  // flush-on-visibilitychange (tab switch, mobile backgrounding, and --
  // critically -- a hard navigation/reload/close, none of which reliably
  // give React's unmount cleanup enough time to finish an in-flight async
  // IndexedDB write or fetch before the JS context is torn down;
  // visibilitychange fires while the page is still alive, so the write
  // actually gets a chance to land).
  // Active reading time -- ticks once per second while the tab is actually
  // visible (not backgrounded), flushed on the same cadence/triggers as
  // progress below. Unlike progress (a position, last-write-wins), this is
  // a delta the server adds atomically (see updateArticleProgress), so a
  // second tab flushing concurrently can't clobber it -- reset to 0 only
  // after each successful flush attempt.
  const accumulatedSecondsRef = useRef(0);
  useEffect(() => {
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") accumulatedSecondsRef.current += 1;
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    function flush() {
      const currentArticle = articleRef.current;
      if (!currentArticle) return;
      const current = latestProgressRef.current;
      const progressChanged = Math.abs(current - currentArticle.progressFraction) > PROGRESS_CHANGE_THRESHOLD;
      const secondsDelta = accumulatedSecondsRef.current;
      if (!progressChanged && secondsDelta === 0) return;
      accumulatedSecondsRef.current = 0;
      updateArticleProgress(currentArticle, current, isAuthenticated, secondsDelta).catch(() => undefined);
    }
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") flush();
    }
    const interval = setInterval(flush, PROGRESS_SAVE_INTERVAL_MS);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flush();
    };
  }, [articleId, isAuthenticated]);

  // Auto-archive on reaching the end -- "Reading" means in progress, not
  // done, so finishing moves it out of the active queue the same way
  // manually clicking the "Archived" tab already does. Fires out of either
  // UNREAD or READING (started it, then finished in the same sitting), but
  // never re-fires once already archived. The ref guard stops a duplicate
  // call racing the `article` state update that would otherwise let the
  // effect fire again before status catches up.
  const autoArchivedRef = useRef(false);
  useEffect(() => {
    autoArchivedRef.current = false;
  }, [articleId]);
  useEffect(() => {
    if (autoArchivedRef.current || !article || article.status === "ARCHIVED") return;
    if (progress < AUTO_READ_PROGRESS_THRESHOLD) return;
    autoArchivedRef.current = true;
    updateArticleStatus(article, "ARCHIVED", isAuthenticated).then(setArticle);
  }, [progress, article, isAuthenticated]);

  // "More from your library" -- computed client-side from tag/title-overlap
  // (see packages/shared/related-articles.ts; there's no embeddings/semantic-
  // search infra yet, this is the cheap stand-in), fetched lazily once the
  // reader nears the end rather than on every visit, since most articles are
  // closed well before that point and the full list isn't otherwise needed.
  const relatedFetchedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!article || progress < AUTO_READ_PROGRESS_THRESHOLD || relatedFetchedForRef.current === articleId) return;
    relatedFetchedForRef.current = articleId;
    loadArticles(isAuthenticated).then((all) => {
      const candidates = (all as Article[]).filter((a) => a.deletedAt === null);
      setRelatedArticles({ articleId, articles: computeRelatedArticles(article, candidates) });
    });
  }, [progress, article, isAuthenticated, articleId]);
  // Tagged with the articleId it was computed for -- on navigating between
  // two reader pages that reuse this same component instance, this stops
  // the previous article's related list from flashing before the new
  // article's own fetch (kicked off by the effect above) resolves.
  const visibleRelated = relatedArticles?.articleId === articleId ? relatedArticles.articles : [];

  // readableText is just "" (tts.play() is a no-op on empty text) until
  // article's actually loaded and the right reader has reported something.
  // What "read aloud" should read: the current PDF page, the current EPUB
  // section, or -- since there's no per-page concept for scrolled HTML --
  // the whole article's plain text.
  const readableText = usesPdfReader
    ? pdfPageText
    : usesEpubReader
      ? epubSectionText
      : (article?.extractedText ?? "");
  const ttsPlayer = useTtsPlayer();
  // The persistent player is global -- "playing" only means *this*
  // article's controls should show as active if it's actually this
  // article's audio playing, not whatever's playing app-wide (e.g. left
  // running from a different article after navigating here).
  const ttsIsThisArticle = article !== undefined && article !== null && ttsPlayer.articleId === article.id;
  const tts = {
    status: ttsIsThisArticle ? ttsPlayer.status : ("idle" as const),
    supported: ttsPlayer.supported,
    play: () => article && ttsPlayer.play(article.id, article.title ?? "Untitled", readableText),
    pause: ttsPlayer.pause,
    resume: ttsPlayer.resume,
    stop: ttsPlayer.stop,
  };

  async function handleCreateHighlight(
    selectedText: string,
    position: HighlightPosition,
    color: HighlightColor,
    note: string,
  ) {
    if (!article) return;
    const created = await createHighlight(
      { articleId: article.id, selectedText, position, color, noteText: note.trim() || undefined },
      isAuthenticated,
    );
    setHighlights((prev) => [...prev, created]);
  }

  async function handleDeleteHighlight(highlightId: string) {
    await deleteHighlight(highlightId, isAuthenticated);
    setHighlights((prev) => prev.filter((h) => h.id !== highlightId));
  }

  async function handleSaveNote(highlightId: string, noteText: string) {
    const target = highlights.find((h) => h.id === highlightId);
    if (!target) return;
    const updated = await saveNote(target, noteText, isAuthenticated);
    setHighlights((prev) => prev.map((h) => (h.id === highlightId ? updated : h)));
  }

  async function handleDeleteNote(highlightId: string) {
    const target = highlights.find((h) => h.id === highlightId);
    if (!target) return;
    const updated = await deleteNote(target, isAuthenticated);
    setHighlights((prev) => prev.map((h) => (h.id === highlightId ? updated : h)));
  }

  // The Notebook panel's "click a highlight to go there" -- HTML jumps
  // directly (the <mark> is already in the DOM, no reader state to
  // reconcile); PDF/EPUB go through a nonce'd prop their own reader
  // consumes, since navigating them means calling into pdfjs/epub.js state
  // this component doesn't own. A fresh nonce every click (not just the
  // target) so clicking the same highlight twice in a row still re-jumps
  // (e.g. after scrolling away from it) instead of no-op'ing on an
  // unchanged prop value.
  function handleJumpToHighlight(highlight: Highlight) {
    const position = highlight.position;
    if (position.type === "text") {
      document
        .querySelector(`mark[data-highlight-id="${highlight.id}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (position.type === "pdf") {
      setJumpToPdfPage({ page: position.pageNumber, nonce: Date.now() });
    } else if (position.type === "epub") {
      setJumpToEpubCfi({ cfi: position.cfi, nonce: Date.now() });
    }
  }

  async function handleStatusChange(nextStatus: ArticleStatus) {
    if (!article) return;
    const updated = await updateArticleStatus(article, nextStatus, isAuthenticated);
    setArticle(updated);
  }

  async function handleSendToKindle() {
    if (!article) return;
    setSendingToKindle(true);
    try {
      await sendArticleToKindle(article.id);
      toast("Sent to your Kindle -- it should show up in your library shortly.");
    } catch (err) {
      toast(
        err instanceof ApiError && err.code === "no_kindle_email"
          ? "Add your Kindle email in Settings first."
          : "Couldn't send that to your Kindle.",
      );
    } finally {
      setSendingToKindle(false);
    }
  }

  if (!loaded) return null;

  if (!article) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-paper px-6 text-center">
        <p className="font-serif text-lg text-ink">Couldn&apos;t find that article.</p>
        <Link href="/library" className="font-sans text-sm font-medium text-accent">
          Back to Library
        </Link>
      </div>
    );
  }

  const remainingMinutes = article.readingTimeEstimate
    ? Math.max(0, Math.round(article.readingTimeEstimate * (1 - progress)))
    : null;
  const label = article.siteName ?? article.author ?? article.originalFilename ?? "Reader";
  const renderHtml =
    usesPdfReader || usesEpubReader
      ? null
      : (article.extractedHtml ?? (article.extractedText ? textToParagraphHtml(article.extractedText) : null));
  const isTextRenderable = renderHtml !== null;

  return (
    <div className="min-h-screen bg-paper">
      <ReaderToolbar
        siteName={label}
        theme={theme}
        onThemeChange={setTheme}
        size={size}
        onSizeChange={setReaderSize}
        progress={progress}
        showNotebook={showNotebook}
        onToggleNotebook={() => setShowNotebook((v) => !v)}
      />
      <main
        className={cn(
          "mx-auto px-6 py-12",
          usesPdfReader || usesEpubReader ? "max-w-[840px]" : "max-w-[680px]",
          reader.showProgressBar && "pb-20",
          // Shifts the centered column left instead of letting it sit
          // underneath the fixed-position Notebook panel -- overriding just
          // margin-right (mx-auto still centers the left side) rather than
          // reworking the layout into a flex row.
          showNotebook && "mr-[380px]",
        )}
      >
        <div className="mb-4 flex items-center gap-2 text-ink-faint">
          <SourceIcon sourceType={article.sourceType} className="h-4 w-4" />
          <span className="font-sans text-xs uppercase tracking-wide">{article.sourceType}</span>
        </div>

        <h1 className="mb-3 text-balance font-serif text-[34px] font-semibold leading-tight text-ink">
          {article.title}
        </h1>
        <p className="mb-5 font-sans text-xs text-ink-faint">
          {article.url ? (
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-2 transition-colors hover:text-accent"
              title="Open the original article"
            >
              {label}
            </a>
          ) : (
            label
          )}
          {article.readingTimeEstimate ? ` · ${formatReadingTime(article.readingTimeEstimate)}` : ""}
          {isTextRenderable && remainingMinutes !== null ? ` · ${formatMinutesLeft(remainingMinutes)}` : ""}
        </p>

        <div className="mb-5 flex items-center justify-between gap-4">
          {/* Each label sizes to its own content instead of a shared
              flex-1 width -- "Unread"/"Reading"/"Archived" are different
              lengths, and forcing them into equal-width segments stretched
              the shorter labels with awkward padding while cramming the
              longest ("Archived") against it, reading as lopsided/smushed
              rather than a clean, evenly-weighted control. */}
          <div className="flex gap-1.5 rounded-sm bg-surface-2 p-1" role="group" aria-label="Article status">
            {STATUS_TABS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => handleStatusChange(t.value)}
                className={cn(
                  "rounded-sm px-3 py-1.5 font-sans text-xs font-medium transition-colors",
                  article.status === t.value ? "bg-accent text-accent-contrast shadow-sm" : "text-ink-muted hover:text-ink",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <TtsControls
            status={tts.status}
            supported={tts.supported}
            hasText={readableText.trim().length > 0}
            onPlay={tts.play}
            onPause={tts.pause}
            onResume={tts.resume}
            onStop={tts.stop}
          />
        </div>

        {isAuthenticated && (
          <button
            type="button"
            onClick={handleSendToKindle}
            disabled={sendingToKindle}
            className="mb-5 inline-flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 font-sans text-xs font-medium text-ink-muted transition-colors hover:border-ink-faint hover:text-ink disabled:opacity-50"
          >
            <IconBook className="h-3.5 w-3.5" />
            {sendingToKindle ? "Sending…" : "Send to Kindle"}
          </button>
        )}

        <div className="mb-9">
          <TagEditor article={article} authenticated={isAuthenticated} onChange={setArticle} />
        </div>

        {article.textSource === "OCR" && (
          <p className="mb-4 rounded-sm bg-highlight-yellow/40 px-3 py-2 font-sans text-xs text-ink">
            This PDF had no text layer -- the text below came from OCR and may contain recognition errors.
          </p>
        )}

        {article.skippedImageCount > 0 && (
          <p className="mb-4 rounded-sm bg-highlight-yellow/40 px-3 py-2 font-sans text-xs text-ink">
            {article.skippedImageCount === 1
              ? "1 image was too large to save and is still loading from the original site."
              : `${article.skippedImageCount} images were too large to save and are still loading from the original site.`}
          </p>
        )}

        {article.sourceType !== "HTML" && (
          <p className="mb-6 font-sans text-xs text-ink-faint">
            {article.sourceType === "PDF" ? "PDF" : "EPUB"}
            {isFileLoadPending
              ? " · loading the original file…"
              : !usesPdfReader && !usesEpubReader
                ? " · shown as extracted text, not the original page layout"
                : ""}
            {article.originalFilename ? ` · ${article.originalFilename}` : ""}
            {downloadUrl && (
              <>
                {" · "}
                <a href={downloadUrl} download={article.originalFilename ?? undefined} className="text-accent">
                  Download original
                </a>
              </>
            )}
          </p>
        )}

        {usesPdfReader ? (
          <PdfReader
            fileBlob={fileBlob!}
            highlights={highlights}
            initialProgressFraction={article.progressFraction}
            onProgressChange={handleProgressChange}
            onPageTextChange={setPdfPageText}
            readingMode={reader.pdfReadingMode}
            jumpToPage={jumpToPdfPage}
            onCreateHighlight={(position, color, note) => handleCreateHighlight(position.text, position, color, note)}
            onDeleteHighlight={handleDeleteHighlight}
            onSaveNote={handleSaveNote}
            onDeleteNote={handleDeleteNote}
          />
        ) : usesEpubReader ? (
          <EpubReader
            fileBlob={fileBlob!}
            highlights={highlights}
            theme={theme}
            size={size}
            initialProgressFraction={article.progressFraction}
            onProgressChange={handleProgressChange}
            onSectionTextChange={setEpubSectionText}
            jumpToCfi={jumpToEpubCfi}
            onCreateHighlight={(cfi, selectedText, color, note) =>
              handleCreateHighlight(selectedText, { type: "epub", cfi }, color, note)
            }
            onDeleteHighlight={handleDeleteHighlight}
            onSaveNote={handleSaveNote}
            onDeleteNote={handleDeleteNote}
          />
        ) : isFileLoadPending ? (
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border px-5 py-16 text-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-ink-faint border-t-transparent" />
            <p className="font-sans text-sm text-ink-muted">Loading the original {article.sourceType === "PDF" ? "PDF" : "EPUB"}…</p>
          </div>
        ) : isTextRenderable ? (
          <ArticleContent
            html={renderHtml ?? ""}
            highlights={highlights}
            size={size}
            onCreateHighlight={(position, color, note) => handleCreateHighlight(position.exact, position, color, note)}
            onDeleteHighlight={handleDeleteHighlight}
            onSaveNote={handleSaveNote}
            onDeleteNote={handleDeleteNote}
            readingChunkText={ttsIsThisArticle && !usesPdfReader && !usesEpubReader ? ttsPlayer.currentChunkText : null}
            readingWordRange={ttsIsThisArticle && !usesPdfReader && !usesEpubReader ? ttsPlayer.currentWordRange : null}
          />
        ) : article.sourceType === "BOOK" ? (
          // No url, no uploaded file -- a Kindle-imported book has nothing
          // to render as "article content," just the highlights recovered
          // from My Clippings.txt, so list those directly instead of
          // showing the generic "couldn't extract" message below (which
          // would be actively misleading here -- there was never anything
          // to extract in the first place).
          <div className="flex flex-col gap-3">
            {highlights.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-5 py-8 text-center">
                <p className="font-sans text-sm text-ink-muted">No highlights for this book yet.</p>
              </div>
            ) : (
              highlights.map((h) => (
                <HighlightListItem
                  key={h.id}
                  highlight={h}
                  articleExtractedText={article.extractedText}
                  onDelete={handleDeleteHighlight}
                  onSaveNote={handleSaveNote}
                  onDeleteNote={handleDeleteNote}
                />
              ))
            )}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border px-5 py-8 text-center">
            <SourceIcon sourceType={article.sourceType} className="mx-auto mb-3 h-6 w-6 text-ink-faint" />
            <p className="font-sans text-sm text-ink-muted">
              {article.extractionError ?? "Couldn't extract readable content for this article."}
            </p>
            {article.originalFilename && (
              <p className="mt-1 font-sans text-xs text-ink-faint">{article.originalFilename}</p>
            )}
          </div>
        )}

        {visibleRelated.length > 0 && (
          <div className="mt-12 border-t border-border pt-8">
            <h2 className="mb-3 font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">
              More from your library
            </h2>
            <div className="flex flex-col gap-1">
              {visibleRelated.map((a) => (
                <Link
                  key={a.id}
                  href={`/reader/${a.id}`}
                  className="rounded-sm px-2 py-2 -mx-2 transition-colors hover:bg-surface-2"
                >
                  <p className="truncate font-serif text-sm text-ink">{a.title ?? "Untitled"}</p>
                  <p className="truncate font-sans text-xs text-ink-faint">
                    {a.siteName ?? a.author ?? "Saved article"}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>

      {showNotebook && (
        <NotebookPanel
          article={article}
          highlights={highlights}
          onJump={handleJumpToHighlight}
          onDeleteHighlight={handleDeleteHighlight}
          onSaveNote={handleSaveNote}
          onDeleteNote={handleDeleteNote}
        />
      )}

      {reader.showProgressBar && <ReaderProgressBar progress={progress} remainingMinutes={remainingMinutes} />}
    </div>
  );
}
