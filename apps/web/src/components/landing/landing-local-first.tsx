import { IconResurface } from "@/components/ui/icons";
import { IconLock, IconOffline } from "./landing-icons";
import { Section, SectionHeading } from "./section";

const COLUMNS = [
  {
    Icon: IconOffline,
    title: "Everything works offline",
    body: "The whole save → read → highlight → resurface loop, plus PDF and EPUB rendering, search, OCR, and read-aloud — with no network and no server round-trip. Signed-out mode is the default path, not a stripped-back demo.",
  },
  {
    Icon: IconLock,
    title: "Your library stays yours",
    body: "Saves and highlights live in your browser's own storage. No tracking, no ads, nothing sold on. Export to Markdown or Anki whenever you like, so nothing you put in here is locked in.",
  },
  {
    Icon: IconResurface,
    title: "An account does one thing",
    body: "It syncs your library across devices — and that's it. Sign in later and everything you already saved locally moves onto the account instead of being left behind.",
  },
];

export function LandingLocalFirst() {
  return (
    <Section id="account-optional">
      <SectionHeading
        eyebrow="Account optional"
        align="center"
        title="No account. No upsell. No catch."
        lead="Nothing in Booklet sits behind a sign-up wall. You can open it right now, save something, highlight it, and be reviewing it next week without ever typing an email address."
      />

      <div className="landing-rule mx-auto mt-14 max-w-3xl" />

      <div className="mt-14 grid gap-10 sm:grid-cols-3 sm:gap-8">
        {COLUMNS.map(({ Icon, title, body }) => (
          <div key={title} className="flex flex-col gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface text-accent">
              <Icon aria-hidden className="h-5 w-5" />
            </span>
            <h3 className="font-serif text-lg font-semibold text-ink">{title}</h3>
            <p className="text-pretty font-sans text-sm leading-relaxed text-ink-muted">{body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
