import {
  IconBook,
  IconEye,
  IconHighlights,
  IconRss,
  IconSearch,
  IconStats,
  IconUpload,
} from "@/components/ui/icons";
import {
  IconAmazonLogo,
  IconAnkiLogo,
  IconInstapaperLogo,
  IconLogseqLogo,
  IconNotionLogo,
  IconObsidianLogo,
  IconPocketLogo,
  IconRoamResearchLogo,
} from "@/components/ui/brand-icons";
import { IconExport, IconLayers, IconSparkle, IconSwatch, IconTag } from "./landing-icons";
import { Section, SectionHeading } from "./section";

const FEATURES = [
  {
    Icon: IconHighlights,
    title: "Highlights that hold",
    body: "Five colours, and a note tucked behind a small icon rather than dumped into the middle of the paragraph. Re-anchoring copes with the source page being re-fetched or reformatted.",
  },
  {
    Icon: IconBook,
    title: "Inline dictionary",
    body: "Select any word — in an article, a PDF, or an EPUB — and the definition opens in a popover right there. No new tab, no losing your place.",
  },
  {
    Icon: IconSearch,
    title: "Ranked full-text search",
    body: "Titles, authors, sites, body text, tags, your highlights, and your notes. Stemmed, multi-word, with snippets and title hits ranked above passing mentions — and it works the same signed out.",
  },
  {
    Icon: IconLayers,
    title: "Collections that keep up",
    body: "Nest a collection under another, or define one by a filter — status, tags, a text query — so its contents update themselves as you save instead of needing to be curated.",
  },
  {
    Icon: IconTag,
    title: "Tags, for when that's all you need",
    body: "Free-form and lighter than a collection. Sometimes you just want a word attached to something so you can find it again.",
  },
  {
    Icon: IconSwatch,
    title: "Four reading themes",
    body: "Paper, Lamp, Night, and a Kindle mode with genuinely no hue anywhere — highlights included, told apart by grey value. Adjustable type size in every reader.",
  },
  {
    Icon: IconEye,
    title: "Picks up where you stopped",
    body: "Scroll position for articles, page for PDFs, chapter for EPUBs — saved often enough to survive a hard reload or a closed tab, not just a tidy navigation away.",
  },
  {
    Icon: IconSparkle,
    title: "More from your library",
    body: "Near the end of something, Booklet surfaces related saves already in your library, scored on overlapping tags, title keywords, site, and author.",
  },
  {
    Icon: IconStats,
    title: "Stats and a Recap",
    body: "An activity heatmap, streaks, completion rate, and time spent — plus a weekly or monthly wrapped-style summary of what you actually read.",
  },
  {
    Icon: IconRss,
    title: "RSS built in",
    body: "Subscribe to a feed, browse its items in Booklet, and pull the ones worth reading into your library. No separate reader to keep in sync.",
  },
  {
    Icon: IconUpload,
    title: "Bring your history with you",
    body: "Pocket and Instapaper CSVs, browser bookmarks, and a real Kindle My Clippings.txt — one article per book, with every highlight and note still attached.",
  },
  {
    Icon: IconExport,
    title: "Take it anywhere",
    body: "Markdown for Obsidian, Notion, or Logseq. Anki decks for your existing review habit. Or email an article straight to your own Kindle.",
  },
];

const INTEGRATIONS = [
  { Icon: IconPocketLogo, label: "Pocket" },
  { Icon: IconInstapaperLogo, label: "Instapaper" },
  { Icon: IconAmazonLogo, label: "Kindle" },
  { Icon: IconObsidianLogo, label: "Obsidian" },
  { Icon: IconNotionLogo, label: "Notion" },
  { Icon: IconLogseqLogo, label: "Logseq" },
  { Icon: IconRoamResearchLogo, label: "Roam" },
  { Icon: IconAnkiLogo, label: "Anki" },
];

export function LandingFeatures() {
  return (
    <Section id="features" className="border-t border-border bg-surface-2/40">
      <SectionHeading
        eyebrow="Everything else"
        align="center"
        title="The rest of what's already in the box"
        lead="Not a roadmap. All of this ships today, and all of it works without an account."
      />

      <ul className="mt-14 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {/* A single-pixel grid gap over a border-coloured background draws
            every internal divider without twelve cards' worth of
            border-collapse arithmetic -- each cell just paints itself. */}
        {FEATURES.map(({ Icon, title, body }) => (
          <li key={title} className="flex flex-col gap-3 bg-surface p-6 transition-colors hover:bg-surface-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-paper text-accent">
              <Icon aria-hidden className="h-4.5 w-4.5" />
            </span>
            <h3 className="font-serif text-lg font-semibold leading-snug text-ink">{title}</h3>
            <p className="text-pretty font-sans text-sm leading-relaxed text-ink-muted">{body}</p>
          </li>
        ))}
      </ul>

      <div className="mt-16 flex flex-col items-center gap-6">
        <p className="font-sans text-xs font-semibold uppercase tracking-[0.16em] text-ink-faint">
          Comes in from, and goes back out to
        </p>
        <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
          {INTEGRATIONS.map(({ Icon, label }) => (
            <li key={label} className="flex items-center gap-2.5 text-ink-muted">
              <Icon aria-hidden className="h-5 w-5" />
              <span className="font-sans text-sm font-medium">{label}</span>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
