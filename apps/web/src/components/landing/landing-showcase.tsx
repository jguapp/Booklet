import { IconCheck } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { Container, Eyebrow } from "./section";
import { DocumentMock, ListenMock, ResurfaceMock } from "./showcase-mocks";

type Row = {
  id: string;
  eyebrow: string;
  title: React.ReactNode;
  lead: string;
  points: string[];
  mock: React.ReactNode;
  /** Mock on the left instead of the right, to break the column rhythm. */
  flipped?: boolean;
};

const ROWS: Row[] = [
  {
    id: "resurfacing",
    eyebrow: "Spaced repetition",
    title: (
      <>
        Every highlight is a flashcard, whether you meant it to be one or not
      </>
    ),
    lead: "Booklet schedules your highlights with SM-2 — the algorithm behind Anki — not a heuristic that shows you random old saves. Recall something and the gap widens; miss it and it comes back soon.",
    points: [
      "A daily or weekly digest, built once and reused — not re-rolled every time you open the page",
      "“Remembered”, “Forgot”, or archive; each answer moves the schedule",
      "Delivered in the app, or emailed to you on your own frequency",
      "Export the same highlights as Anki decks or Markdown if you'd rather review elsewhere",
    ],
    mock: <ResurfaceMock />,
  },
  {
    id: "documents",
    eyebrow: "PDF & EPUB",
    title: <>A PDF stays a PDF. An EPUB stays a book.</>,
    lead: "Most apps flatten an upload into a wall of extracted text and lose the layout, the figures, and the page numbers with it. Booklet renders the real document in the browser.",
    points: [
      "PDF pages render to canvas with a positioned, selectable text layer over them",
      "EPUBs paginate properly, chapter by chapter, with your place remembered",
      "Highlights anchor to page coordinates or an EPUB CFI range — not a fragile character offset",
      "A scanned PDF with no text layer is put through OCR on upload, with no button to press",
    ],
    mock: <DocumentMock />,
    flipped: true,
  },
  {
    id: "listen",
    eyebrow: "Read aloud",
    title: <>Listen to anything you saved, in a real voice</>,
    lead: "Use your browser's built-in speech for zero setup, or switch to Kokoro — an open-weight 82M-parameter model that Booklet runs itself. No API key, no per-character billing, no audio leaving the server.",
    points: [
      "A player bar that keeps going when you navigate away from the article",
      "Word-level read-along highlighting, plus a marker on the paragraph being read",
      "Generation keeps pace with playback — roughly a millisecond between sentences",
      "Both engines work the same way on articles, PDFs, and EPUBs",
    ],
    mock: <ListenMock />,
  },
];

export function LandingShowcase() {
  return (
    <div className="border-y border-border bg-surface-2/40">
      <Container className="flex flex-col gap-24 py-20 sm:gap-28 sm:py-28">
        {ROWS.map((row) => (
          <section
            key={row.id}
            id={row.id}
            className="scroll-mt-20 grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-14"
          >
            <div
              className={cn(
                "flex flex-col gap-5 lg:col-span-6",
                row.flipped ? "lg:order-2" : "lg:order-1",
              )}
            >
              <Eyebrow>{row.eyebrow}</Eyebrow>
              <h2 className="text-balance font-serif text-3xl font-semibold leading-[1.15] tracking-[-0.01em] text-ink sm:text-[2.35rem]">
                {row.title}
              </h2>
              <p className="text-pretty font-sans text-base leading-relaxed text-ink-muted">
                {row.lead}
              </p>
              <ul className="flex flex-col gap-3">
                {row.points.map((point) => (
                  <li key={point} className="flex items-start gap-3">
                    <IconCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    <span className="text-pretty font-sans text-sm leading-relaxed text-ink-muted">
                      {point}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className={cn("lg:col-span-6", row.flipped ? "lg:order-1" : "lg:order-2")}>
              {row.mock}
            </div>
          </section>
        ))}
      </Container>
    </div>
  );
}
