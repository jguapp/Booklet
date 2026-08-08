import { IconFileText, IconResurface } from "@/components/ui/icons";

/**
 * The hero's product shot -- built in markup rather than captured as a
 * screenshot, for two reasons that both matter more than the extra lines:
 * it themes with the rest of the page (a PNG of the light reader would sit
 * dead-white inside the Night theme), and it stays sharp at any density
 * without shipping a 3x asset.
 *
 * It shows the two halves of the product in one frame on purpose -- a
 * highlight being made in the reader, and that same highlight coming back
 * as a review card. That pairing is the entire pitch, and it's much faster
 * to see than to read.
 */
export function ReaderMock() {
  return (
    // pb/pl give the overlapping review card room to hang outside the
    // reader frame without being clipped or overflowing the grid column.
    // The bottom padding is generous on purpose: it's what lets the review
    // card sit low enough to overlap the reader's blank lower margin rather
    // than covering the middle of a paragraph, which reads as a broken
    // layout rather than a card resting on a page.
    <div className="relative pb-4 lg:pb-28 lg:pl-12">
      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.18)]">
        {/* Reader toolbar */}
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2/60 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-ink-faint/30" />
            <span className="h-2.5 w-2.5 rounded-full bg-ink-faint/30" />
            <span className="h-2.5 w-2.5 rounded-full bg-ink-faint/30" />
          </div>
          <div className="flex items-center gap-3 font-sans text-[11px] font-medium text-ink-faint">
            <span className="rounded-sm border border-border px-1.5 py-0.5">Aa</span>
            <span>Paper</span>
            <span aria-hidden>·</span>
            <span>62%</span>
          </div>
        </div>

        {/* Reading progress */}
        <div className="h-0.75 w-full bg-border/60">
          <div className="h-full w-[62%] bg-accent" />
        </div>

        <div className="px-6 pb-7 pt-6 sm:px-8 lg:pb-20">
          <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            paulgraham.com <span aria-hidden>·</span> 14 min read
          </p>
          <h3 className="mt-2.5 font-serif text-xl font-semibold leading-snug text-ink sm:text-2xl">
            How to Do Great Work
          </h3>

          <div className="mt-4 space-y-3.5 font-serif text-[15px] leading-[1.75] text-ink">
            <p>
              The first step is to decide what to work on. The work you choose needs to have three
              qualities: it has to be something you have a natural aptitude for, that you have a deep
              interest in, and that offers scope to do great work.
            </p>
            <p>
              {/* A real <mark>, the same element the reader renders a saved
                  highlight with, plus the click-to-open note affordance that
                  sits beside one that has a note attached. */}
              <mark className="rounded-[3px] bg-highlight-yellow px-0.5 text-ink">
                What you need to do is give these things an unfair amount of your attention.
              </mark>
              <span className="ml-1 inline-flex translate-y-0.5 items-center rounded-sm border border-border bg-surface-2 px-1 py-0.5 align-middle text-ink-muted">
                <IconFileText aria-hidden className="h-3 w-3" />
              </span>{" "}
              Curiosity is the best guide. Your curiosity never lies, and it knows more than you do
              about what&apos;s worth paying attention to.
            </p>
            <p className="text-ink-muted">
              Four steps: choose a field, learn enough to get to the frontier, notice gaps, explore
              promising ones. This is how practically everyone who&apos;s done great work has done it.
            </p>
          </div>
        </div>
      </div>

      {/* The same highlight, weeks later, as a review card. Static and in
          flow on small screens; overlapping the reader frame on large ones,
          with a degree of rotation so it reads as a separate slip of paper
          rather than a nested panel. */}
      <div className="mt-4 lg:absolute lg:bottom-0 lg:left-0 lg:mt-0 lg:w-72 lg:-rotate-2">
        <div className="rounded-lg border border-border bg-paper p-4 shadow-[0_2px_4px_rgba(0,0,0,0.05),0_16px_36px_-14px_rgba(0,0,0,0.28)]">
          <div className="flex items-center gap-2 font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
            <IconResurface aria-hidden className="h-3.5 w-3.5" />
            Resurfaced today
          </div>
          <blockquote className="mt-2.5 border-l-2 border-highlight-yellow pl-3 font-serif text-[13.5px] italic leading-relaxed text-ink">
            &ldquo;Give these things an unfair amount of your attention.&rdquo;
          </blockquote>
          <p className="mt-2 font-sans text-[11px] text-ink-faint">
            Saved 23 days ago <span aria-hidden>·</span> 3rd review
          </p>
          <div className="mt-3.5 flex items-center gap-2">
            <span className="flex-1 rounded-sm bg-accent px-3 py-1.5 text-center font-sans text-xs font-semibold text-accent-contrast">
              Remembered
            </span>
            <span className="flex-1 rounded-sm border border-border px-3 py-1.5 text-center font-sans text-xs font-semibold text-ink-muted">
              Forgot
            </span>
          </div>
          <p className="mt-2.5 font-sans text-[11px] text-ink-faint">
            Next review in <span className="font-semibold text-ink-muted">16 days</span>
          </p>
        </div>
      </div>
    </div>
  );
}
