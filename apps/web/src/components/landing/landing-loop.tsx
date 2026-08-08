import { IconBook, IconHighlights, IconResurface, IconUpload } from "@/components/ui/icons";
import { Section, SectionHeading } from "./section";

const STEPS = [
  {
    Icon: IconUpload,
    title: "Save",
    body: "Paste a URL, drop in a PDF or EPUB, click the extension, subscribe to a feed, or import your whole Pocket, Instapaper, or Kindle export. Images get inlined, so an article outlives the site it came from.",
  },
  {
    Icon: IconBook,
    title: "Read",
    body: "A clean reading view in four themes with adjustable type — and real page rendering for PDF and EPUB, not a text dump. Your place is kept. Or hand it to the narrator and listen instead.",
  },
  {
    Icon: IconHighlights,
    title: "Highlight",
    body: "Select anything to mark it, in five colours, with a note attached if you want one. Look up a word inline without opening a tab. Highlights survive the page being re-fetched or reformatted.",
  },
  {
    Icon: IconResurface,
    title: "Resurface",
    body: "Your highlights come back as a daily or weekly review — in the app or by email. Say what you remembered; the schedule adjusts. That's the loop most read-it-later apps never close.",
  },
];

export function LandingLoop() {
  return (
    <Section id="how-it-works">
      <SectionHeading
        eyebrow="The loop"
        align="center"
        title="Save it, read it, mark it — then actually keep it"
        lead="Four steps, and the fourth one is the reason the other three are worth doing."
      />

      <div className="relative mt-16">
        {/* Hairline threading the four step markers together. Inset to the
            centre of the first and last columns (1/8 and 7/8 of a 4-up grid)
            so it starts and ends inside a marker rather than dangling. */}
        <div
          className="absolute left-[12.5%] right-[12.5%] top-6 hidden h-px bg-border lg:block"
          aria-hidden
        />

        <ol className="relative grid gap-12 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          {STEPS.map(({ Icon, title, body }, index) => (
            <li key={title} className="flex flex-col items-start gap-4 lg:items-center lg:text-center">
              <div className="flex items-center gap-3 lg:flex-col lg:gap-3">
                {/* bg-paper (the page colour, not the card colour) is what
                    makes the connector appear to pass behind the marker. */}
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-paper text-accent">
                  <Icon aria-hidden className="h-5 w-5" />
                </span>
                <span className="font-sans text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  Step {index + 1}
                </span>
              </div>
              <h3 className="font-serif text-xl font-semibold text-ink">{title}</h3>
              <p className="text-pretty font-sans text-sm leading-relaxed text-ink-muted">{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}
