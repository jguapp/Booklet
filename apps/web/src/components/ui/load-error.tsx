"use client";

/**
 * What a page shows when its own first data load rejected.
 *
 * Every list page here followed the same shape: fetch in a `refresh`
 * callback, flip a `loaded` flag in `.then`, and `return null` until it is
 * set. With no `.catch`, a rejected fetch -- API down, offline, a 500 --
 * left `loaded` false forever, so the page rendered literally nothing: no
 * spinner, no message, no retry, just an empty frame that looks like a
 * finished render of an empty account. That is the worst version of a
 * silent failure, because the honest interpretation of it ("my library is
 * gone") is the alarming one.
 *
 * Deliberately built from the same markup as those pages' existing
 * empty-state blocks rather than a new visual treatment -- this is a
 * correctness fix, not a design one, and the owner's redesign should find
 * one fewer thing invented on the way past.
 */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-md border border-dashed border-border px-6 py-16 text-center">
      <p className="font-sans text-sm text-ink-muted">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 font-sans text-xs font-medium text-accent hover:underline"
      >
        Try again
      </button>
    </div>
  );
}
