"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Input } from "./input";

interface RenameDialogProps {
  title: string;
  label: string;
  initialValue: string;
  confirmLabel?: string;
  maxLength?: number;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

/** Branded replacement for `window.prompt()`, matching ConfirmDialog's own
 * shape/behavior (portaled, Escape to dismiss, click-outside to dismiss) --
 * see that file for why the portal specifically is load-bearing. */
export function RenameDialog({
  title,
  label,
  initialValue,
  confirmLabel = "Save",
  maxLength = 300,
  onConfirm,
  onCancel,
}: RenameDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  const trimmed = value.trim();
  const canSave = trimmed.length > 0 && trimmed !== initialValue.trim();

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/40 px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-dialog-title"
        className="w-full max-w-sm rounded-md border border-border bg-surface p-5 shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) onConfirm(trimmed);
        }}
      >
        <h2 id="rename-dialog-title" className="font-serif text-lg font-semibold text-ink">
          {title}
        </h2>
        <label className="mt-4 flex flex-col gap-1.5">
          <span className="font-sans text-xs font-medium text-ink-muted">{label}</span>
          <Input
            ref={inputRef}
            value={value}
            maxLength={maxLength}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-sm px-3 py-1.5 font-sans text-sm font-medium text-ink-muted hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="rounded-sm bg-accent px-3 py-1.5 font-sans text-sm font-semibold text-accent-contrast hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
