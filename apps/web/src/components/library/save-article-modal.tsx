"use client";

import { useEffect, useRef, useState } from "react";
import type { Article } from "@booklet/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconLink, IconUpload } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { ApiError, saveArticleFromFile, saveArticleFromUrl } from "@/lib/data/articles";

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100MB, matches the API's multipart limit

type Mode = "url" | "file";
type Status = "idle" | "loading" | "error";

interface SaveArticleModalProps {
  authenticated: boolean;
  onClose: () => void;
  onSaved: (article: Article) => void;
}

function ensureProtocol(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export function SaveArticleModal({ authenticated, onClose, onSaved }: SaveArticleModalProps) {
  const [mode, setMode] = useState<Mode>("url");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Read during render, not inside an effect: React applies the url-mode
  // input's autoFocus during commit, which runs *before* passive effects --
  // by the time a useEffect could read document.activeElement, it would
  // already be this dialog's own input, not whatever opened the dialog.
  const previouslyFocusedRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // The backdrop covers the whole page but isn't inert -- without this, Tab
  // walks focus straight out of the dialog into the Library page underneath
  // it, which a sighted keyboard user can't even see is happening since the
  // backdrop visually hides it.
  useEffect(() => {
    const previouslyFocused = previouslyFocusedRef.current;

    function handleTab(e: KeyboardEvent) {
      if (e.key !== "Tab" || !dialogRef.current) return;
      // offsetParent is null for display:none elements (e.g. the file mode's
      // hidden <input>) -- querySelectorAll alone would still match those,
      // which would throw off which element is really first/last in tab order.
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleTab);
    return () => {
      document.removeEventListener("keydown", handleTab);
      previouslyFocused?.focus?.();
    };
  }, []);

  function validateFile(candidate: File): string | null {
    const isPdf = candidate.name.toLowerCase().endsWith(".pdf");
    const isEpub = candidate.name.toLowerCase().endsWith(".epub");
    if (!isPdf && !isEpub) return "Only .pdf and .epub files are supported.";
    if (candidate.size > MAX_FILE_BYTES) return "That file is over the 100MB limit.";
    return null;
  }

  function handleFileChosen(candidate: File) {
    const validationError = validateFile(candidate);
    if (validationError) {
      setError(validationError);
      setFile(null);
      return;
    }
    setError(null);
    setFile(candidate);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "url" && !url.trim()) {
      setError("Paste a URL first.");
      return;
    }
    if (mode === "file" && !file) {
      setError("Choose a .pdf or .epub file first.");
      return;
    }

    setStatus("loading");
    try {
      const article =
        mode === "url" ? await saveArticleFromUrl(ensureProtocol(url.trim()), authenticated) : await saveArticleFromFile(file!, authenticated);
      if (article.extractionStatus === "FAILED") {
        setStatus("error");
        setError(
          article.extractionError ??
            (mode === "url"
              ? "Couldn't extract that page. It may be behind a login or block automated fetches."
              : "Couldn't read that file. It may be corrupted or password-protected."),
        );
        return;
      }
      onSaved(article);
    } catch (err) {
      setStatus("error");
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onMouseDown={(e) => {
        if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-article-heading"
        className="w-full max-w-md rounded-md border border-border bg-surface p-6 shadow-lg"
      >
        <h2 id="save-article-heading" className="mb-4 font-serif text-lg font-semibold text-ink">
          Save an article
        </h2>

        <div className="mb-5 flex gap-1 rounded-sm bg-surface-2 p-1">
          <button
            type="button"
            onClick={() => setMode("url")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
              mode === "url" ? "bg-accent text-accent-contrast shadow-sm" : "text-ink-muted",
            )}
          >
            <IconLink className="h-3.5 w-3.5" /> Paste a URL
          </button>
          <button
            type="button"
            onClick={() => setMode("file")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
              mode === "file" ? "bg-accent text-accent-contrast shadow-sm" : "text-ink-muted",
            )}
          >
            <IconUpload className="h-3.5 w-3.5" /> Upload a file
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {mode === "url" ? (
            <Input
              type="text"
              autoFocus
              placeholder="https://example.com/an-article"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={status === "loading"}
            />
          ) : (
            <div
              role="button"
              tabIndex={0}
              aria-label="Choose a .pdf or .epub file to upload"
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const dropped = e.dataTransfer.files[0];
                if (dropped) handleFileChosen(dropped);
              }}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-sm border border-dashed px-4 py-8 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent",
                dragOver ? "border-accent bg-surface-2" : "border-border",
              )}
            >
              <IconUpload className="h-6 w-6 text-ink-faint" />
              <p className="font-sans text-sm text-ink-muted">
                {file ? file.name : "Drag a .pdf or .epub here, or click to browse"}
              </p>
              <p className="font-sans text-xs text-ink-faint">Up to 100MB</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.epub"
                className="hidden"
                onChange={(e) => {
                  const chosen = e.target.files?.[0];
                  if (chosen) handleFileChosen(chosen);
                }}
              />
            </div>
          )}

          {error && (
            <p className="rounded-sm bg-highlight-orange px-3 py-2 font-sans text-xs text-ink">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={status === "loading"}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={status === "loading"}>
              {status === "loading" ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
