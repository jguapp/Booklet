import { ButtonLink } from "@/components/ui/button";
import { IconBook, IconGlobe, IconVolume } from "@/components/ui/icons";
import { IconCode, IconOffline } from "./landing-icons";
import { Container, Chip } from "./section";
import { ReaderMock } from "./reader-mock";

const TRUST_CHIPS = [
  { Icon: IconOffline, label: "Works fully offline" },
  { Icon: IconBook, label: "PDF & EPUB, really rendered" },
  { Icon: IconVolume, label: "Self-hosted read-aloud" },
  { Icon: IconGlobe, label: "Browser extension" },
  { Icon: IconCode, label: "Public API" },
];

export function LandingHero() {
  return (
    <div className="landing-glow relative overflow-hidden border-b border-border">
      <Container className="grid grid-cols-1 items-center gap-14 py-16 sm:py-20 lg:grid-cols-12 lg:gap-10 lg:py-24">
        <div className="landing-rise flex flex-col items-start gap-6 lg:col-span-6">
          <Chip className="bg-surface/80">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Read-it-later, rebuilt around the highlight
          </Chip>

          <h1 className="text-balance font-serif text-4xl font-semibold leading-[1.08] tracking-[-0.02em] text-ink sm:text-5xl lg:text-[3.4rem]">
            Save what you find.{" "}
            <mark className="rounded-[4px] bg-highlight-yellow px-1.5 text-ink">Keep</mark> what you
            highlight.
          </h1>

          <p className="max-w-xl text-pretty font-sans text-lg leading-relaxed text-ink-muted">
            Every read-it-later app can save an article. Booklet is built around the part they all
            drop: your highlights come back, on a real spaced-repetition schedule, until you actually
            remember them.
          </p>

          {/* Full-width and stacked on a phone: side by side, two buttons
              sized to their own label lengths read as ragged rather than as
              a pair. */}
          <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center">
            <ButtonLink href="/library" variant="primary" className="px-6 py-3 text-base">
              Start reading — it&apos;s free
            </ButtonLink>
            <ButtonLink href="/signup" variant="secondary" className="px-6 py-3 text-base">
              Create an account
            </ButtonLink>
          </div>

          <p className="max-w-md font-sans text-sm leading-relaxed text-ink-faint">
            No account, no paywall, nothing gated. Your library lives in your browser until you decide
            you want it on another device.
          </p>

          <ul className="mt-1 flex flex-wrap gap-2">
            {TRUST_CHIPS.map(({ Icon, label }) => (
              <li key={label}>
                <Chip className="bg-surface/70">
                  <Icon aria-hidden className="h-3.5 w-3.5 text-accent" />
                  {label}
                </Chip>
              </li>
            ))}
          </ul>
        </div>

        {/* 120ms behind the copy -- enough that the eye lands on the headline
            first, short enough that it still reads as one movement. */}
        <div className="landing-rise lg:col-span-6" style={{ animationDelay: "120ms" }}>
          <ReaderMock />
        </div>
      </Container>
    </div>
  );
}
