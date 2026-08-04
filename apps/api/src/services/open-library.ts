/**
 * Open Library metadata enrichment for uploaded books.
 *
 * Purely additive: every function here returns null rather than throwing, and
 * the upload route treats a null as "carry on with what extraction gave us".
 * An upload must never fail, or even slow down noticeably, because a
 * third-party catalogue is down -- this runs on the request path today
 * (there's no background-job infra yet, same constraint pdf-extraction.ts's
 * OCR path notes), which is exactly why everything below is timeout-bounded
 * and failure-swallowing.
 */

export interface OpenLibraryMetadata {
  title: string | null;
  author: string | null;
  coverImageUrl: string | null;
}

// Enrichment is a nicety on top of a working upload -- it is not worth adding
// seconds to a request that already did OCR or a full EPUB parse.
const REQUEST_TIMEOUT_MS = 5_000;
// Covers ride along in Article.coverImageUrl as a data: URI and are loaded on
// every library card, so an oversized one is a real cost on a hot path.
// Open Library's -M covers are comfortably under this; the cap is here to
// bound a surprise, not to trim normal responses.
const MAX_COVER_BYTES = 2 * 1024 * 1024;

/**
 * Is this title bad enough to be worth replacing with a catalogue lookup?
 *
 * Deliberately conservative in one direction only: a false negative just
 * means we skip enrichment and keep today's behaviour, while a false positive
 * risks overwriting a real title with a wrong-edition match. Everything here
 * is a shape that a human-authored book title essentially never has.
 */
export function isWeakBookTitle(title: string | null | undefined, filenameTitle: string): boolean {
  const trimmed = title?.trim();
  if (!trimmed) return true;

  // Extraction fell through to the filename, or the embedded title is just
  // the filename again -- no new information either way.
  if (trimmed.toLowerCase() === filenameTitle.trim().toLowerCase()) return true;

  // Producer junk. These are the literal defaults PDF writers leave behind
  // when nobody set a title, and they show up constantly in the wild.
  if (/^(untitled|document\d*|microsoft word\s*-|pdfdocument|output|scan(ned|\d*)\b)/i.test(trimmed)) return true;

  // Still carrying a file extension.
  if (/\.(pdf|epub|docx?|txt)$/i.test(trimmed)) return true;

  // Separator-cased with no real spaces: "pride_and_prejudice", "the-hobbit".
  // Underscores never appear in a typeset title, so they're damning on their
  // own. Hyphens are not -- "Catch-22" and "Slaughterhouse-Five" are real
  // titles with no spaces either -- so a hyphen only counts against a title
  // that is also entirely lowercase, which is filename casing rather than
  // anything a publisher produced.
  if (!/\s/.test(trimmed) && (/_/.test(trimmed) || (/-/.test(trimmed) && trimmed === trimmed.toLowerCase()))) {
    return true;
  }

  // Versioning/working-copy suffixes: "... FINAL v2", "... (draft)", "... copy".
  if (/\b(final|draft|copy|rev\d*|v\d+)\b\s*$/i.test(trimmed)) return true;

  // A long digit run is an ISBN, a catalogue number, or a scan id -- never
  // part of a title. Short numbers are fine ("1984", "Catch-22").
  if (/\d{6,}/.test(trimmed)) return true;

  // A single word with no spaces that isn't plausibly a real one-word title.
  if (trimmed.length < 3) return true;

  return false;
}

/**
 * Turn "9780141439518_pride_and_prejudice_FINAL_v2.epub" into
 * "pride and prejudice" -- something worth putting in a search box.
 */
export function titleQueryFromFilename(filename: string): string {
  return filename
    .replace(/\.(pdf|epub)$/i, "")
    .replace(/[_+]+/g, " ")
    // Hyphens are ambiguous (a separator in "the-hobbit", but real in
    // "Catch-22"), so only collapse them when they're clearly separating words.
    .replace(/(?<=[a-z])-(?=[a-z])/gi, " ")
    .replace(/\b(final|draft|copy|scan(ned)?|ocr|ebook|retail|unabridged|rev\d*|v\d+)\b/gi, " ")
    .replace(/\d{6,}/g, " ") // ISBNs and scan ids
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ") // "(z-lib.org)", "[Anna's Archive]"
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Recover an ISBN from any of the given strings (filename first, then the
 * book's own opening pages). Preferred over a title search because it's an
 * exact identifier -- a title search can and does return the wrong edition.
 */
export function extractIsbn(candidates: (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;

    // Explicitly labelled first -- "ISBN: 978-0-14-143951-8" on a copyright
    // page is far more trustworthy than a bare digit run elsewhere.
    const labelled = candidate.match(/ISBN(?:-1[03])?:?\s*((?:97[89][\s-]?)?(?:\d[\s-]?){9}[\dXx])/);
    // Not \b-delimited: an ISBN in a filename is usually butted straight up
    // against an underscore ("9780141439518_pride..."), and `_` is a word
    // character, so a trailing \b would never match there.
    const raw = labelled?.[1] ?? candidate.match(/(?<!\d)(97[89](?:[\s-]?\d){10})(?!\d)/)?.[1];
    if (!raw) continue;

    const digits = raw.replace(/[\s-]/g, "").toUpperCase();
    if (digits.length === 13 || digits.length === 10) return digits;
  }
  return null;
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        // Open Library asks for a contactable UA and rate-limits anonymous
        // traffic harder without one.
        "User-Agent": "Booklet/0.1 (+https://github.com/jguapp/Booklet)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

async function fetchCoverDataUri(coverUrl: string): Promise<string | null> {
  try {
    const res = await fetch(coverUrl, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    // Open Library serves a 1x1 GIF placeholder rather than a 404 for books
    // it has no cover for, so "tiny" means "no cover", not "small cover".
    if (buffer.byteLength < 512 || buffer.byteLength > MAX_COVER_BYTES) return null;

    return `data:${contentType.split(";")[0]};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const found = value.find((v) => typeof v === "string" && v.trim());
    return typeof found === "string" ? found.trim() : null;
  }
  return null;
}

async function lookupByIsbn(isbn: string): Promise<OpenLibraryMetadata | null> {
  const data = await fetchJson(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`,
  );
  if (!data || typeof data !== "object") return null;

  const entry = (data as Record<string, unknown>)[`ISBN:${isbn}`];
  if (!entry || typeof entry !== "object") return null;

  const record = entry as Record<string, unknown>;
  const authors = Array.isArray(record.authors) ? record.authors : [];
  const authorName = authors
    .map((a) => (a && typeof a === "object" ? firstString((a as Record<string, unknown>).name) : null))
    .find((n): n is string => Boolean(n));

  const cover = record.cover && typeof record.cover === "object" ? (record.cover as Record<string, unknown>) : null;
  const coverUrl = firstString(cover?.medium ?? cover?.large ?? cover?.small);

  return {
    title: firstString(record.title),
    author: authorName ?? null,
    coverImageUrl: coverUrl ? await fetchCoverDataUri(coverUrl) : null,
  };
}

async function lookupByTitle(title: string): Promise<OpenLibraryMetadata | null> {
  const data = await fetchJson(
    `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&limit=1&fields=title,author_name,cover_i`,
  );
  if (!data || typeof data !== "object") return null;

  const docs = (data as Record<string, unknown>).docs;
  if (!Array.isArray(docs) || docs.length === 0) return null;

  const doc = docs[0] as Record<string, unknown>;
  const coverId = typeof doc.cover_i === "number" ? doc.cover_i : null;

  return {
    title: firstString(doc.title),
    author: firstString(doc.author_name),
    coverImageUrl: coverId ? await fetchCoverDataUri(`https://covers.openlibrary.org/b/id/${coverId}-M.jpg`) : null,
  };
}

/**
 * Look the book up, ISBN first. Returns null when there's nothing usable --
 * no match, no network, a match with no title -- so the caller can't
 * accidentally overwrite real metadata with blanks.
 */
export async function lookupBookMetadata(input: {
  originalFilename: string;
  /** The book's opening text, if extraction produced any -- searched for a
   * copyright-page ISBN. Only the start is used; an ISBN is never buried
   * halfway through a book. */
  text?: string | null;
}): Promise<OpenLibraryMetadata | null> {
  const isbn = extractIsbn([input.originalFilename, input.text?.slice(0, 4000)]);

  const result = isbn ? await lookupByIsbn(isbn) : null;
  if (result?.title) return result;

  const query = titleQueryFromFilename(input.originalFilename);
  // Two characters of filename left after cleaning isn't a search, it's noise.
  if (query.length < 3) return null;

  const bySearch = await lookupByTitle(query);
  return bySearch?.title ? bySearch : null;
}
