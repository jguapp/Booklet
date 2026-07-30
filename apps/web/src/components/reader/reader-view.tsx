"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Article, ArticleStatus, Highlight, HighlightColor, HighlightPosition } from "@booklet/shared";
import { computeRelatedArticles } from "@booklet/shared";
import { useTheme } from "@/lib/theme/theme-provider";
import { loadArticle, loadArticleFile, loadArticles, updateArticleProgress, updateArticleStatus } from "@/lib/data/articles";
import { createHighlight, deleteHighlight, deleteNote, loadHighlights, saveNote } from "@/lib/data/highlights";
import { useAuth } from "@/lib/auth/auth-provider";
import { formatReadingTime } from "@/lib/format";
import { textToParagraphHtml } from "@/lib/reader/text-to-html";
import { useDevicePrefs } from "@/lib/data/device-prefs-provider";
import { ReaderToolbar } from "./reader-toolbar";
import { ArticleContent } from "./article-content";
import { PdfReader } from "./pdf-reader";
import { EpubReader } from "./epub-reader";
import { TtsControls } from "./tts-controls";
import { useTextToSpeech } from "@/lib/reader/use-text-to-speech";
import { TagEditor } from "@/components/library/tag-editor";
import { SourceIcon } from "@/components/library/source-icon";
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
  const [article, setArticle] = useState<Article | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [progress, setProgress] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [fileBlob, setFileBlob] = useState<Blob | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [pdfPageText, setPdfPageText] = useState("");
  const [epubSectionText, setEpubSectionText] = useState("");
  const [relatedArticles, setRelatedArticles] = useState<{ articleId: string; articles: Article[] } | null>(null);

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
  const loadedFileKeyRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadFile() {
      if (!article || (article.sourceType !== "PDF" && article.sourceType !== "EPUB")) {
        loadedFileKeyRef.current = null;
        if (!cancelled) {
          setFileBlob(null);
          setDownloadUrl(null);
        }
        return;
      }
      const key = `${article.id}:${article.sourceType}:${isAuthenticated}`;
      if (key === loadedFileKeyRef.current) return;
      loadedFileKeyRef.current = key;
      const blob = await loadArticleFile(article.id, isAuthenticated).catch(() => null);
      if (cancelled || !blob) return;
      setFileBlob(blob);
      objectUrl = URL.createObjectURL(blob);
      setDownloadUrl(objectUrl);
    }

    loadFile();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [article, isAuthenticated]);

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

  useEffect(() => {
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
  }, []);

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

  // Hooks can't be called after the !loaded/!article early returns below, so
  // this has to live up here -- readableText is just "" (tts.play() is a
  // no-op on empty text) until article's actually loaded and the right
  // reader has reported something. What "read aloud" should read: the
  // current PDF page, the current EPUB section, or -- since there's no
  // per-page concept for scrolled HTML -- the whole article's plain text.
  const usesPdfReaderForTts = article?.sourceType === "PDF" && fileBlob !== null;
  const usesEpubReaderForTts = article?.sourceType === "EPUB" && fileBlob !== null;
  const readableText = usesPdfReaderForTts
    ? pdfPageText
    : usesEpubReaderForTts
      ? epubSectionText
      : (article?.extractedText ?? "");
  const tts = useTextToSpeech(readableText);

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

  async function handleStatusChange(nextStatus: ArticleStatus) {
    if (!article) return;
    const updated = await updateArticleStatus(article, nextStatus, isAuthenticated);
    setArticle(updated);
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
  // PDF and EPUB each get their own real reader once the file's loaded
  // (pdf-reader.tsx, epub-reader.tsx). A source whose file failed to load
  // (or an old article saved before either reader existed) falls back to
  // the extracted-text-through-the-HTML-highlighter path, same as before.
  const usesPdfReader = article.sourceType === "PDF" && fileBlob !== null;
  const usesEpubReader = article.sourceType === "EPUB" && fileBlob !== null;
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
      />
      <main className={cn("mx-auto px-6 py-12", usesPdfReader || usesEpubReader ? "max-w-[840px]" : "max-w-[680px]")}>
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
          {isTextRenderable && remainingMinutes !== null ? ` · ${remainingMinutes} min left` : ""}
        </p>

        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex gap-1 rounded-sm bg-surface-2 p-1" role="group" aria-label="Article status">
            {STATUS_TABS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => handleStatusChange(t.value)}
                className={cn(
                  "flex-1 rounded-sm py-1.5 font-sans text-xs font-medium transition-colors",
                  article.status === t.value ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
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

        <div className="mb-9">
          <TagEditor article={article} authenticated={isAuthenticated} onChange={setArticle} />
        </div>

        {article.sourceType !== "HTML" && (
          <p className="mb-6 font-sans text-xs text-ink-faint">
            {article.sourceType === "PDF" ? "PDF" : "EPUB"}
            {!usesPdfReader && !usesEpubReader ? " · shown as extracted text, not the original page layout" : ""}
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
            onCreateHighlight={(cfi, selectedText, color, note) =>
              handleCreateHighlight(selectedText, { type: "epub", cfi }, color, note)
            }
            onDeleteHighlight={handleDeleteHighlight}
            onSaveNote={handleSaveNote}
            onDeleteNote={handleDeleteNote}
          />
        ) : isTextRenderable ? (
          <ArticleContent
            html={renderHtml ?? ""}
            highlights={highlights}
            size={size}
            onCreateHighlight={(position, color, note) => handleCreateHighlight(position.exact, position, color, note)}
            onDeleteHighlight={handleDeleteHighlight}
            onSaveNote={handleSaveNote}
            onDeleteNote={handleDeleteNote}
          />
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
    </div>
  );
}
