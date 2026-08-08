import type { SeedCollection } from "@booklet/shared";

/**
 * Hand-picked passages from works that are unambiguously in the public
 * domain, checked into the repo as data (#158 part 2).
 *
 * This exists to solve the bootstrapping problem honestly. The good version
 * of onboarding seeds is the cross-user aggregate in aggregation-service.ts
 * -- but on day one there are no users, so the aggregate is empty and a new
 * account would land on "nothing here yet", which is exactly the failure the
 * feature was supposed to fix. These carry that gap, and keep carrying the
 * long tail of topics the aggregate never reaches.
 *
 * What this deliberately is *not*: scraped. The issue rules out Amazon/Kindle
 * "Popular Highlights" as a terms-of-service and copyright gray area, and
 * nothing here comes from any third party's highlight data. Every passage is
 * from a work published long enough ago to be out of copyright worldwide,
 * transcribed here rather than fetched.
 *
 * Rules for adding to this list, learned the hard way from how much
 * misattributed "classic" quotation circulates online:
 *
 * 1. The work must be public domain, not merely old. For a translated work
 *    that means the *translation* must be public domain too -- a modern
 *    translation of Marcus Aurelius is a new copyrighted work, so the
 *    translator is named on every entry that has one and only pre-1929
 *    translations are used.
 * 2. Quote verbatim from the work, not from a quotation site. Popular
 *    "quotes" are very often paraphrases that were never written by the
 *    person they are credited to.
 * 3. If you are not confident in both the wording and the attribution, leave
 *    it out. A short correct list is worth more than a long shaky one.
 *
 * Source links point at Project Gutenberg. Where the exact ebook number
 * isn't certain, the link is a Gutenberg search for the work instead of a
 * guessed id -- a confidently wrong direct link is a misattribution, which
 * is the one thing this file cannot afford.
 */

function gutenbergSearch(query: string): string {
  return `https://www.gutenberg.org/ebooks/search/?query=${encodeURIComponent(query)}`;
}

export const PUBLIC_DOMAIN_SEED_COLLECTIONS: SeedCollection[] = [
  {
    id: "pd-stoics",
    title: "The Stoics, in their own words",
    description:
      "Four passages on what is and isn't in your control, in translations old enough to be public domain.",
    highlights: [
      {
        text: "Begin the morning by saying to thyself, I shall meet with the busybody, the ungrateful, arrogant, deceitful, envious, unsocial.",
        sourceTitle: "Meditations",
        sourceAuthor: "Marcus Aurelius",
        translator: "George Long (1862)",
        sourceUrl: "https://www.gutenberg.org/ebooks/2680",
        origin: "public-domain",
      },
      {
        text: "Men seek retreats for themselves, houses in the country, sea-shores, and mountains; and thou too art wont to desire such things very much. But this is altogether a mark of the most common sort of men, for it is in thy power whenever thou shalt choose to retire into thyself.",
        sourceTitle: "Meditations",
        sourceAuthor: "Marcus Aurelius",
        translator: "George Long (1862)",
        sourceUrl: "https://www.gutenberg.org/ebooks/2680",
        origin: "public-domain",
      },
      {
        text: "Men are disturbed, not by things, but by the principles and notions which they form concerning things.",
        sourceTitle: "The Enchiridion",
        sourceAuthor: "Epictetus",
        translator: "Elizabeth Carter (1758)",
        sourceUrl: gutenbergSearch("Epictetus Enchiridion Carter"),
        origin: "public-domain",
      },
      {
        text: "There are more things, Lucilius, likely to frighten us than there are to crush us; we suffer more often in imagination than in reality.",
        sourceTitle: "Moral Letters to Lucilius, Letter XIII",
        sourceAuthor: "Seneca",
        translator: "Richard Mott Gummere (1917)",
        sourceUrl: gutenbergSearch("Seneca Moral Letters to Lucilius"),
        origin: "public-domain",
      },
    ],
  },
  {
    id: "pd-first-lines",
    title: "First lines that earn the rest of the book",
    description: "Openings that do more work in one sentence than most chapters do in twenty pages.",
    highlights: [
      {
        text: "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.",
        sourceTitle: "Pride and Prejudice",
        sourceAuthor: "Jane Austen",
        sourceUrl: "https://www.gutenberg.org/ebooks/1342",
        origin: "public-domain",
      },
      {
        text: "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, it was the season of Darkness.",
        sourceTitle: "A Tale of Two Cities",
        sourceAuthor: "Charles Dickens",
        sourceUrl: "https://www.gutenberg.org/ebooks/98",
        origin: "public-domain",
      },
      {
        text: "Happy families are all alike; every unhappy family is unhappy in its own way.",
        sourceTitle: "Anna Karenina",
        sourceAuthor: "Leo Tolstoy",
        translator: "Constance Garnett (1901)",
        sourceUrl: "https://www.gutenberg.org/ebooks/1399",
        origin: "public-domain",
      },
      {
        text: "Call me Ishmael. Some years ago—never mind how long precisely—having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world.",
        sourceTitle: "Moby-Dick",
        sourceAuthor: "Herman Melville",
        sourceUrl: "https://www.gutenberg.org/ebooks/2701",
        origin: "public-domain",
      },
    ],
  },
  {
    id: "pd-attention",
    title: "Attention, and where to point it",
    description: "On knowing what you actually want before optimizing the route there.",
    highlights: [
      {
        text: "I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived.",
        sourceTitle: "Walden",
        sourceAuthor: "Henry David Thoreau",
        sourceUrl: "https://www.gutenberg.org/ebooks/205",
        origin: "public-domain",
      },
      {
        text: "The mass of men lead lives of quiet desperation. What is called resignation is confirmed desperation.",
        sourceTitle: "Walden",
        sourceAuthor: "Henry David Thoreau",
        sourceUrl: "https://www.gutenberg.org/ebooks/205",
        origin: "public-domain",
      },
      {
        text: "A foolish consistency is the hobgoblin of little minds, adored by little statesmen and philosophers and divines.",
        sourceTitle: "Self-Reliance",
        sourceAuthor: "Ralph Waldo Emerson",
        sourceUrl: gutenbergSearch("Emerson Essays First Series"),
        origin: "public-domain",
      },
      {
        text: "“Would you tell me, please, which way I ought to go from here?” “That depends a good deal on where you want to get to,” said the Cat.",
        sourceTitle: "Alice's Adventures in Wonderland",
        sourceAuthor: "Lewis Carroll",
        sourceUrl: "https://www.gutenberg.org/ebooks/11",
        origin: "public-domain",
      },
      {
        text: "If you know the enemy and know yourself, you need not fear the result of a hundred battles.",
        sourceTitle: "The Art of War",
        sourceAuthor: "Sun Tzu",
        translator: "Lionel Giles (1910)",
        sourceUrl: "https://www.gutenberg.org/ebooks/132",
        origin: "public-domain",
      },
    ],
  },
  {
    id: "pd-arguments",
    title: "Arguments that changed the rules",
    description: "Six passages that moved an argument permanently, each still readable in an afternoon.",
    highlights: [
      {
        text: "If all mankind minus one, were of one opinion, and only one person were of the contrary opinion, mankind would be no more justified in silencing that one person, than he, if he had the power, would be justified in silencing mankind.",
        sourceTitle: "On Liberty",
        sourceAuthor: "John Stuart Mill",
        sourceUrl: gutenbergSearch("On Liberty Mill"),
        origin: "public-domain",
      },
      {
        text: "I do not wish them to have power over men; but over themselves.",
        sourceTitle: "A Vindication of the Rights of Woman",
        sourceAuthor: "Mary Wollstonecraft",
        sourceUrl: gutenbergSearch("Vindication of the Rights of Woman"),
        origin: "public-domain",
      },
      {
        text: "You have seen how a man was made a slave; you shall see how a slave was made a man.",
        sourceTitle: "Narrative of the Life of Frederick Douglass, an American Slave",
        sourceAuthor: "Frederick Douglass",
        sourceUrl: gutenbergSearch("Narrative of the Life of Frederick Douglass"),
        origin: "public-domain",
      },
      {
        text: "Four score and seven years ago our fathers brought forth on this continent, a new nation, conceived in Liberty, and dedicated to the proposition that all men are created equal.",
        sourceTitle: "The Gettysburg Address",
        sourceAuthor: "Abraham Lincoln",
        sourceUrl: "https://en.wikisource.org/wiki/Gettysburg_Address",
        origin: "public-domain",
      },
      {
        text: "There is grandeur in this view of life, with its several powers, having been originally breathed into a few forms or into one; and that, whilst this planet has gone cycling on according to the fixed law of gravity, from so simple a beginning endless forms most beautiful and most wonderful have been, and are being, evolved.",
        sourceTitle: "On the Origin of Species (first edition)",
        sourceAuthor: "Charles Darwin",
        sourceUrl: gutenbergSearch("Origin of Species Darwin first edition"),
        origin: "public-domain",
      },
      {
        text: "It is not from the benevolence of the butcher, the brewer, or the baker that we expect our dinner, but from their regard to their own interest.",
        sourceTitle: "An Inquiry into the Nature and Causes of the Wealth of Nations",
        sourceAuthor: "Adam Smith",
        sourceUrl: gutenbergSearch("Wealth of Nations Adam Smith"),
        origin: "public-domain",
      },
    ],
  },
];
