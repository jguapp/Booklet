"use client";

import { useEffect, useState } from "react";
import type { SeedCollection } from "@booklet/shared";
import { loadOnboardingSeeds } from "@/lib/data/shares";

/**
 * What an account with no highlights yet is shown instead of an empty box
 * (#158 part 2).
 *
 * Rendered on the Highlights page rather than in a signup wizard because
 * this is where "I have nothing here" is actually felt, and because it then
 * works for the local-only mode too -- the seeds endpoint needs no session
 * (see lib/data/shares.ts). It disappears on its own the moment there is a
 * real highlight to show, so it never becomes furniture.
 */
export function SeedCollections() {
  const [collections, setCollections] = useState<SeedCollection[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadOnboardingSeeds()
      .then((res) => !cancelled && setCollections(res.collections))
      // Seeds are a nicety on an empty page; a failed fetch leaves the
      // ordinary empty state, not an error.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (collections.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="font-serif text-lg font-semibold text-ink">Something to read in the meantime</h2>
      <p className="mt-1 font-sans text-sm text-ink-muted">
        Passages worth keeping, from books nobody owns anymore and from what other readers have published.
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {collections.map((collection) => {
          const open = expanded === collection.id;
          return (
            <div key={collection.id} className="rounded-md border border-border bg-surface">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : collection.id)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-serif text-base text-ink">{collection.title}</span>
                  <span className="block font-sans text-xs text-ink-faint">{collection.description}</span>
                </span>
                <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 font-sans text-xs text-ink-muted">
                  {collection.highlights.length}
                </span>
              </button>

              {open && (
                <div className="flex flex-col gap-3 border-t border-border px-4 py-4">
                  {collection.highlights.map((highlight, index) => (
                    <blockquote key={index}>
                      <p className="font-serif text-base leading-snug text-ink">
                        &ldquo;{highlight.text}&rdquo;
                      </p>
                      <p className="mt-1.5 font-sans text-xs text-ink-faint">
                        {/* Attribution is not optional decoration here: for
                            the public-domain half it is what makes quoting
                            the passage honest, and for the community half
                            the count is the only thing that may ever be
                            said about who highlighted it. */}
                        {highlight.sourceUrl ? (
                          <a
                            href={highlight.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:underline"
                          >
                            {highlight.sourceTitle}
                          </a>
                        ) : (
                          highlight.sourceTitle
                        )}
                        {highlight.sourceAuthor && ` · ${highlight.sourceAuthor}`}
                        {highlight.translator && ` · trans. ${highlight.translator}`}
                        {highlight.origin === "community" &&
                          highlight.highlightedBy != null &&
                          ` · ${highlight.highlightedBy} readers highlighted this`}
                      </p>
                    </blockquote>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
