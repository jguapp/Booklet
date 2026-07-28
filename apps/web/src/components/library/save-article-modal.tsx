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

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function validateFile(candidate: File): string | null {
    const isPdf = candidate.name.toLowerCase().endsWith(".pdf");
    const isEpub = candidate.name.toLowerCase().endsWith(".epub");
    if (!isPdf && !isEpub) return "Only .pdf and .epub files are supported.";
    if (isEpub && !authenticated) return "EPUB uploads require an account -- PDF works without one.";
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
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-sm border border-dashed px-4 py-8 text-center transition-colors",
                dragOver ? "border-accent bg-surface-2" : "border-border",
              )}
            >
              <IconUpload className="h-6 w-6 text-ink-faint" />
              <p className="font-sans text-sm text-ink-muted">
                {file ? file.name : "Drag a .pdf or .epub here, or click to browse"}
              </p>
              <p className="font-sans text-xs text-ink-faint">
                Up to 100MB{!authenticated ? " · EPUB requires an account" : ""}
              </p>
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
