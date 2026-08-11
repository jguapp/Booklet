import { Section, SectionHeading } from "./section";

/**
 * Native <details>/<summary>, no state, no client component -- consistent
 * with the page's "server component all the way down" rule (see
 * app/page.tsx). The five questions are the ones the earlier sections
 * raise but don't close: they're answers to real objections, not filler
 * for a search-engine checkbox.
 */
const FAQS = [
  {
    q: "Do I need an account?",
    a: "No. Everything — saving, reading, highlighting, Daily Review, even read-aloud — works signed out, stored in your browser. An account exists for one reason: syncing your library across devices. If you sign up later, everything you saved locally moves onto the account.",
  },
  {
    q: "What can I save?",
    a: "Web articles by URL, PDFs and EPUBs by upload (including scanned PDFs, which go through OCR), RSS subscriptions, and Kindle highlights via a My Clippings.txt import. Articles are extracted into a clean reading view; PDFs and EPUBs render as real pages.",
  },
  {
    q: "What happens to my highlights?",
    a: "They come back to you. Daily Review resurfaces a few highlights each day on a real spaced-repetition schedule (SM-2, the same algorithm Anki uses) — telling it \"remembered\" or \"forgot\" pushes each one further out or brings it back sooner. You can also attach a recall prompt to a highlight so it's shown as a question first.",
  },
  {
    q: "Can it read articles to me?",
    a: "Yes — read-aloud uses a neural voice with word-level follow-along in the reader, and you can subscribe to your own unread queue as a private podcast feed in any podcast app, with lock-screen controls and offline listening.",
  },
  {
    q: "Is my reading data private?",
    a: "Signed out, it never leaves your device. Signed in, it syncs to your account and nowhere else — no tracking, no ads, no selling on. You can export everything to Markdown or Anki at any time, and deleting your account removes all of it immediately, including shared links.",
  },
];

export function LandingFaq() {
  return (
    <Section id="faq">
      <SectionHeading eyebrow="FAQ" align="center" title="Fair questions" />

      <div className="mx-auto mt-10 flex max-w-2xl flex-col gap-3">
        {FAQS.map(({ q, a }) => (
          <details key={q} className="group rounded-md border border-border bg-surface px-5 py-4">
            <summary className="cursor-pointer list-none font-serif text-base font-semibold text-ink marker:content-none [&::-webkit-details-marker]:hidden">
              <span className="flex items-center justify-between gap-3">
                {q}
                <span aria-hidden className="text-ink-faint transition-transform group-open:rotate-45">
                  +
                </span>
              </span>
            </summary>
            <p className="mt-3 text-pretty font-sans text-sm leading-relaxed text-ink-muted">{a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
