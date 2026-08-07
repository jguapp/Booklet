"use client";

/**
 * The opt-in for local semantic search (#156).
 *
 * This exists because the cost is the user's to accept, not ours to spend: a
 * ~25MB model download and minutes of CPU indexing their library. The server
 * does the same work invisibly for signed-in users because it does it once, on
 * its own hardware, at save time -- which is why this control only appears in
 * local mode. Showing it to a signed-in user would offer them a switch for
 * something they already have.
 *
 * Indexing runs here, in a settings page the user is looking at, rather than
 * being triggered by the first search. A search that silently blocks for
 * minutes behind a download reads as a broken search box; a progress count on
 * a switch you just flipped reads as what it is.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/auth-provider";
import { useDevicePrefs } from "@/lib/data/device-prefs-provider";
import { localArticles, localEmbeddings } from "@/lib/local/db";
import { type IndexProgress, buildLocalEmbeddingIndex, terminateEmbeddingWorker } from "@/lib/search/local-embeddings";
import { cn } from "@/lib/cn";

/**
 * One value rather than a progress object plus an error string plus a boolean.
 * The first version of this used `progress: IndexProgress | null` for both
 * "working" and "finished" and cleared it when the run ended, which made
 * "done" literally unrepresentable -- the finished message could never render.
 * A union makes each state exist exactly once and the invalid combinations
 * unspellable.
 */
type IndexState =
  | { kind: "idle" }
  | { kind: "indexing"; progress: IndexProgress }
  | { kind: "done" }
  | { kind: "error"; message: string };

export function SemanticSearchSetting() {
  const { isAuthenticated } = useAuth();
  // Through the shared device-prefs context rather than reading localStorage
  // here. The first version of this component did its own read-after-mount,
  // which is the exact bug that provider was created to fix: two components
  // reading the same key independently drift apart until a reload. It also
  // owns the SSR-defaults-then-correct-after-mount dance in one place.
  const { semanticSearch: enabled, setSemanticSearch } = useDevicePrefs();
  const [state, setState] = useState<IndexState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  // Stop any in-flight indexing if this page goes away -- otherwise navigating
  // off leaves the worker embedding a library nobody is watching.
  useEffect(() => () => abortRef.current?.abort(), []);

  const runIndex = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: "indexing", progress: { done: 0, total: 0 } });
    try {
      const articles = await localArticles.getAll();
      await buildLocalEmbeddingIndex(articles, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (!controller.signal.aborted) setState({ kind: "indexing", progress });
        },
      });
      if (!controller.signal.aborted) setState({ kind: "done" });
    } catch (err) {
      // Most likely offline, or the Hub unreachable. Said plainly rather than
      // silently: the user just asked for this, so nothing happening needs an
      // explanation. Search itself keeps working -- it stays keyword-only.
      if (!controller.signal.aborted) {
        setState({ kind: "error", message: err instanceof Error ? err.message : "Indexing failed." });
      }
    }
  }, []);

  function handleToggle(next: boolean) {
    setSemanticSearch(next);
    if (next) {
      void runIndex();
    } else {
      // Turning it off has to actually stop the work, free the model's WASM
      // heap, and drop the vectors -- a switch that leaves 25MB of model
      // resident and a library's worth of embeddings on disk is not off.
      abortRef.current?.abort();
      abortRef.current = null;
      setState({ kind: "idle" });
      terminateEmbeddingWorker();
      void localEmbeddings.clear();
    }
  }

  if (isAuthenticated) return null;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">Semantic search</h3>
      <p className="font-sans text-xs text-ink-faint">
        Finds articles by meaning as well as by words -- searching &ldquo;why deadlines make people creative&rdquo;
        can turn up a piece about working under constraint that never uses any of those words. Runs entirely on
        this device: turning it on downloads a ~25MB model once and indexes your library in the background, which
        takes a few minutes the first time.
      </p>
      <div className="flex gap-1 rounded-sm bg-surface-2 p-1" role="group" aria-label="Semantic search">
        <button
          type="button"
          onClick={() => handleToggle(false)}
          className={cn(
            "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
            !enabled ? "bg-accent text-accent-contrast shadow-sm" : "text-ink-muted hover:text-ink",
          )}
        >
          Off
        </button>
        <button
          type="button"
          onClick={() => handleToggle(true)}
          className={cn(
            "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
            enabled ? "bg-accent text-accent-contrast shadow-sm" : "text-ink-muted hover:text-ink",
          )}
        >
          On
        </button>
      </div>
      {state.kind === "indexing" && state.progress.total > 0 && (
        <p className="font-sans text-xs text-ink-faint" role="status">
          Indexing {state.progress.done} of {state.progress.total} articles. You can leave this page -- it will pick
          up where it left off.
        </p>
      )}
      {state.kind === "done" && (
        <p className="font-sans text-xs text-ink-faint" role="status">
          Your library is fully indexed.
        </p>
      )}
      {state.kind === "error" && (
        <p className="font-sans text-xs text-red-500" role="alert">
          {state.message} Search still works -- it just won&apos;t match by meaning yet.
        </p>
      )}
    </section>
  );
}
