"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Branded replacement for `window.confirm()` -- destructive actions (delete
 * a highlight, delete a note) get this instead of the unstyled system popup. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/40 px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-sm rounded-md border border-border bg-surface p-5 shadow-xl"
      >
        <h2 id="confirm-dialog-title" className="font-serif text-lg font-semibold text-ink">
          {title}
        </h2>
        <p className="mt-2 font-sans text-sm text-ink-muted">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-sm px-3 py-1.5 font-sans text-sm font-medium text-ink-muted hover:bg-surface-2"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={cn(
              "rounded-sm px-3 py-1.5 font-sans text-sm font-semibold",
              danger ? "bg-red-500 text-white hover:bg-red-600" : "bg-accent text-accent-contrast hover:bg-accent-strong",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
