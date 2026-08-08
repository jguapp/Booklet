"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PublicShareResponse } from "@booklet/shared";
import { highlightColorHex } from "@booklet/shared";
import { loadPublicShare } from "@/lib/data/shares";

type State =
  | { status: "loading" }
  | { status: "ready"; share: PublicShareResponse }
  // One state for every failure. The API answers a revoked slug and a slug
  // that never existed identically (see routes/shares.ts), and this page must
  // not undo that by rendering a friendlier message for one of them.
  | { status: "unavailable" };

/**
 * Renders exactly what the public endpoint returns and nothing else -- it has
 * no access to anything else, since it never sends credentials (see
 * publicFetch in lib/data/shares.ts) and the payload carries no account
 * fields to accidentally display.
 */
export function PublicSharePage({ slug }: { slug: string }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadPublicShare(slug)
      .then((share) => !cancelled && setState({ status: "ready", share }))
      .catch(() => !cancelled && setState({ status: "unavailable" }));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state.status === "loading") {
    return (
      <main className="mx-auto max-w-2xl px-8 py-16">
        <p className="font-sans text-sm text-ink-muted">Loading…</p>
      </main>
    );
  }

  if (state.status === "unavailable") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-8 text-center">
        <h1 className="font-serif text-2xl font-semibold text-ink">This link isn&rsquo;t available</h1>
        <p className="mt-3 font-sans text-sm text-ink-muted">
          It may have been unshared by whoever sent it to you.
        </p>
        <Link href="/" className="mt-6 font-sans text-sm font-medium text-accent hover:underline">
          What is Booklet?
        </Link>
      </main>
    );
  }

  const { share } = state;
  const single = share.articles.length === 1;

  return (
    <main className="mx-auto max-w-2xl px-8 py-12">
      <header className="mb-8 border-b border-border pb-6">
        <p className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Shared highlights
        </p>
        <h1 className="mt-2 font-serif text-3xl font-semibold text-ink">{share.title}</h1>
        <p className="mt-2 font-sans text-sm text-ink-muted">
          {share.highlightCount} passage{share.highlightCount === 1 ? "" : "s"}
          {!single && ` from ${share.articles.length} articles`}
          {/* Month and year, not a precise timestamp: the useful thing about
              a published page is roughly how old it is, and "shared at 11:04
              last Tuesday" is a fact about the owner's evening rather than
              about the page. */}
          {` · shared ${new Date(share.sharedAt).toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}`}
        </p>
      </header>

      {share.articles.length === 0 ? (
        <p className="font-sans text-sm text-ink-muted">Nothing has been highlighted here yet.</p>
      ) : (
        <div className="flex flex-col gap-10">
          {share.articles.map((article, articleIndex) => (
            // Keyed by index: the payload carries no ids by design, and the
            // list is static for the lifetime of the page.
            <section key={articleIndex}>
              {/* Attribution above the passages, not buried under them --
                  these are excerpts from someone else's work, and the credit
                  is the part that makes publishing them defensible. */}
              <h2 className="font-serif text-lg font-semibold text-ink">
                {article.source.url ? (
                  <a
                    href={article.source.url}
                    target="_blank"
                    // noopener/noreferrer because this points at an arbitrary
                    // third-party URL saved by a stranger: without it the
                    // destination gets a handle on this window via
                    // window.opener, and the referrer would carry the slug --
                    // i.e. hand the unlisted URL to every site linked from a
                    // shared page.
                    rel="noopener noreferrer nofollow"
                    className="text-accent hover:underline"
                  >
                    {article.source.title}
                  </a>
                ) : (
                  article.source.title
                )}
              </h2>
              <p className="mt-1 font-sans text-xs text-ink-faint">
                {[article.source.author, article.source.siteName].filter(Boolean).join(" · ") || "Original source"}
              </p>

              <div className="mt-4 flex flex-col gap-3">
                {article.highlights.map((highlight, index) => (
                  <blockquote
                    key={index}
                    className="rounded-md border border-border bg-surface px-5 py-4"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: highlightColorHex(highlight.color) }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-serif text-base leading-snug text-ink">
                          &ldquo;{highlight.text}&rdquo;
                        </p>
                        {highlight.note && (
                          <p className="mt-2 font-sans text-sm text-ink-muted">{highlight.note}</p>
                        )}
                      </div>
                    </div>
                  </blockquote>
                ))}
              </div>

              {article.source.url && (
                <a
                  href={article.source.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="mt-3 inline-block font-sans text-xs font-medium text-accent hover:underline"
                >
                  Read the original →
                </a>
              )}
            </section>
          ))}
        </div>
      )}

      <footer className="mt-14 border-t border-border pt-6">
        <p className="font-sans text-xs text-ink-faint">
          These are one reader&rsquo;s own highlights, quoted with a link to each original.
        </p>
        <Link href="/signup" className="mt-1 inline-block font-sans text-sm font-medium text-accent hover:underline">
          Keep your own highlights with Booklet →
        </Link>
      </footer>
    </main>
  );
}
