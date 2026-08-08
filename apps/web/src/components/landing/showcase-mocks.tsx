import { IconPause, IconResurface, IconVolume } from "@/components/ui/icons";
import { IconScan } from "./landing-icons";

/**
 * One mock per showcase row. Same reasoning as ReaderMock: markup rather
 * than screenshots, so they theme correctly and stay sharp -- and where the
 * app already has a class for the thing being shown (`.reading-word`,
 * `.reading-section-active`), these use that exact class rather than an
 * approximation of it, so the read-along preview can't drift away from what
 * the reader actually renders.
 */

const FRAME =
  "overflow-hidden rounded-lg border border-border bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_28px_-14px_rgba(0,0,0,0.16)]";

/** Growing gaps between review dates -- the whole point of SM-2, drawn. */
const INTERVALS = [
  { label: "1d", grow: "1" },
  { label: "6d", grow: "1.7" },
  { label: "16d", grow: "2.8" },
  { label: "41d", grow: "4.2" },
];

export function ResurfaceMock() {
  return (
    <div className={FRAME}>
      <div className="flex items-center justify-between border-b border-border bg-surface-2/60 px-5 py-3">
        <div className="flex items-center gap-2 font-sans text-sm font-semibold text-ink">
          <IconResurface aria-hidden className="h-4 w-4 text-accent" />
          Daily Review
        </div>
        <span className="font-sans text-xs font-medium text-ink-faint">3 of 12</span>
      </div>

      <div className="px-5 py-5 sm:px-6">
        <blockquote className="border-l-2 border-highlight-green pl-4 font-serif text-[15px] leading-relaxed text-ink">
          &ldquo;The trouble with a queue is that it measures intent, not memory. Nothing in it ever
          asks you what you kept.&rdquo;
        </blockquote>
        <p className="mt-3 font-sans text-xs text-ink-faint">
          The Reading Backlog Problem <span aria-hidden>·</span> saved 5 weeks ago
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="rounded-sm bg-accent px-3.5 py-2 font-sans text-xs font-semibold text-accent-contrast">
            Remembered
          </span>
          <span className="rounded-sm border border-border px-3.5 py-2 font-sans text-xs font-semibold text-ink-muted">
            Forgot
          </span>
          <span className="rounded-sm px-3.5 py-2 font-sans text-xs font-semibold text-ink-faint">
            Archive
          </span>
        </div>

        <div className="mt-6 border-t border-border pt-5">
          <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            If you remember it
          </p>
          {/* flex-grow ratios rather than fixed widths so the ladder keeps
              its accelerating rhythm at every container width. */}
          <div className="mt-3 flex items-center">
            {INTERVALS.map(({ label, grow }, index) => (
              <div key={label} className="flex items-center" style={{ flexGrow: Number(grow) }}>
                <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
                <span className="h-px flex-1 bg-border" />
                {index === INTERVALS.length - 1 ? (
                  <span className="h-2 w-2 shrink-0 rounded-full border border-border bg-paper" />
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center">
            {INTERVALS.map(({ label, grow }) => (
              <span
                key={label}
                className="font-sans text-[11px] font-medium text-ink-muted"
                style={{ flexGrow: Number(grow), flexBasis: 0 }}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DocumentMock() {
  /** Ruled lines standing in for body copy, with the highlighted run marked. */
  const lines: Array<{ width: string; mark?: boolean }> = [
    { width: "96%" },
    { width: "91%" },
    { width: "72%", mark: true },
    { width: "88%", mark: true },
    { width: "94%" },
    { width: "60%" },
  ];

  return (
    <div className="relative">
      {/* Page 8 peeking out behind page 7 -- a document is a stack, and one
          floating rectangle doesn't say that. */}
      <div
        className="absolute inset-x-6 -top-3 h-8 rounded-t-lg border border-b-0 border-border bg-surface-2"
        aria-hidden
      />
      <div className={`relative ${FRAME}`}>
        <div className="flex items-center justify-between border-b border-border bg-surface-2/60 px-5 py-3">
          <span className="truncate font-sans text-sm font-semibold text-ink">
            Thinking, Fast and Slow.pdf
          </span>
          <span className="shrink-0 font-sans text-xs font-medium text-ink-faint">Page 7 / 214</span>
        </div>

        <div className="bg-paper/40 px-6 py-6">
          <div className="rounded-sm border border-border bg-surface px-5 py-5">
            <p className="font-serif text-base font-semibold text-ink">2 · Attention and Effort</p>
            <div className="mt-4 space-y-2.5">
              {lines.map(({ width, mark }, index) => (
                <div
                  key={index}
                  style={{ width }}
                  className={
                    mark
                      ? "h-2.5 rounded-xs bg-highlight-blue"
                      : "h-2.5 rounded-xs bg-ink-faint/20"
                  }
                />
              ))}
            </div>
            <div className="mt-5 space-y-2.5">
              {["82%", "89%", "45%"].map((width) => (
                <div key={width} style={{ width }} className="h-2.5 rounded-xs bg-ink-faint/20" />
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-5 py-3">
          <span className="font-sans text-[11px] font-medium text-ink-muted">
            Highlight anchored to <span className="text-ink">page 7, rect 3</span>
          </span>
          <span className="inline-flex items-center gap-1.5 font-sans text-[11px] font-medium text-ink-faint">
            <IconScan aria-hidden className="h-3.5 w-3.5" />
            OCR ran automatically
          </span>
        </div>
      </div>
    </div>
  );
}

export function ListenMock() {
  return (
    <div className={FRAME}>
      <div className="px-6 py-6">
        {/* The real read-along classes, not lookalikes -- see this file's
            header comment. */}
        <div className="reading-section-active font-serif text-[15px] leading-[1.8] text-ink">
          <p>
            Attention is a finite resource, and the mind spends it the way a careless household spends
            money. <span className="reading-word">Effort</span> is the price of coherence, and most of
            what we call thinking is an attempt to avoid paying it.
          </p>
        </div>
        <p className="mt-3.5 font-serif text-[15px] leading-[1.8] text-ink-faint">
          The law of least effort asserts that if there are several ways of achieving the same goal,
          people will eventually gravitate to the least demanding course of action.
        </p>
      </div>

      {/* The persistent player bar, which in the real app follows you out of
          the article and keeps playing. */}
      <div className="border-t border-border bg-surface-2/70 px-4 py-3.5">
        <div className="flex items-center gap-3.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-contrast">
            <IconPause aria-hidden className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate font-sans text-[13px] font-semibold text-ink">
                Attention and Effort
              </p>
              <p className="shrink-0 font-sans text-[11px] font-medium text-ink-faint">4:12 / 11:36</p>
            </div>
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border">
              <div className="h-full w-[36%] rounded-full bg-accent" />
            </div>
          </div>
          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            <span className="rounded-sm border border-border bg-surface px-2 py-1 font-sans text-[11px] font-semibold text-ink-muted">
              1.0×
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface px-2 py-1 font-sans text-[11px] font-semibold text-ink-muted">
              <IconVolume aria-hidden className="h-3.5 w-3.5" />
              Kokoro
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
