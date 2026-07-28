"use client";

import { useEffect, useRef, useState } from "react";
import type { Article } from "@booklet/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconLink, IconUpload } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { ApiError, saveArticleFromUrl } from "@/lib/data/articles";

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
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!url.trim()) {
      setError("Paste a URL first.");
      return;
    }

    setStatus("loading");
    try {
      const article = await saveArticleFromUrl(ensureProtocol(url.trim()), authenticated);
      if (article.extractionStatus === "FAILED") {
        setStatus("error");
        setError(
          article.extractionError ??
            "Couldn't extract that page. It may be behind a login or block automated fetches.",
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
      <div ref={dialogRef} className="w-full max-w-md rounded-md border border-border bg-surface p-6 shadow-lg">
        <h2 className="mb-4 font-serif text-lg font-semibold text-ink">Save an article</h2>

        <div className="mb-5 flex gap-1 rounded-sm bg-surface-2 p-1">
          <button
            type="button"
            onClick={() => setMode("url")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
              mode === "url" ? "bg-surface text-ink shadow-sm" : "text-ink-muted",
            )}
          >
            <IconLink className="h-3.5 w-3.5" /> Paste a URL
          </button>
          <button
            type="button"
            onClick={() => setMode("file")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
              mode === "file" ? "bg-surface text-ink shadow-sm" : "text-ink-muted",
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
              onClick={() => fileInputRef.current?.click()}
              className="flex cursor-not-allowed flex-col items-center gap-2 rounded-sm border border-dashed border-border px-4 py-8 text-center opacity-60"
            >
              <IconUpload className="h-6 w-6 text-ink-faint" />
              <p className="font-sans text-sm text-ink-muted">PDF and EPUB uploads are coming soon</p>
              <p className="font-sans text-xs text-ink-faint">For now, paste a URL instead</p>
              <input ref={fileInputRef} type="file" accept=".pdf,.epub" className="hidden" disabled />
            </div>
          )}

          {error && (
            <p className="rounded-sm bg-highlight-orange px-3 py-2 font-sans text-xs text-ink">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={status === "loading"}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={status === "loading" || mode === "file"}>
              {status === "loading" ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
