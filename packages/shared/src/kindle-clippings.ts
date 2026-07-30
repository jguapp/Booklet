import type { HighlightColor } from "./types/highlight";

/**
 * Kindle's "My Clippings.txt" -- a plain-text file every Kindle device
 * writes locally, one entry per highlight/note/bookmark, in this shape:
 *
 *   Book Title (Author Name)
 *   - Your Highlight on page 12 | Location 234-236 | Added on Sunday, ...
 *
 *   The highlighted passage itself.
 *   ==========
 *
 * No official API produces this -- it only exists as a file the user
 * copies off their device over USB, which is why this is a file import,
 * not a live sync (see the issue this shipped from for why Kindle has no
 * real sync API to build against at all).
 */
export interface KindleClippingEntry {
  bookTitle: string;
  author: string | null;
  type: "highlight" | "note" | "bookmark";
  text: string;
}

/** Groups by book so callers can create one Article per book and attach
 * every highlight/note to it, rather than one article per clipping. */
export interface KindleBook {
  title: string;
  author: string | null;
  entries: KindleClippingEntry[];
}

const ENTRY_SEPARATOR = /\r?\n={5,}\r?\n?/;

function parseTitleLine(line: string): { title: string; author: string | null } {
  // "Book Title (Author Name)" -- the author is everything in the last
  // parenthesized group, since a title itself can legitimately contain
  // parentheses (subtitles, series names).
  const match = line.match(/^(.*)\s\(([^()]+)\)\s*$/);
  if (!match) return { title: line.trim(), author: null };
  return { title: match[1].trim(), author: match[2].trim() };
}

function parseEntryType(metaLine: string): "highlight" | "note" | "bookmark" {
  const lower = metaLine.toLowerCase();
  if (lower.includes("your note")) return "note";
  if (lower.includes("your bookmark")) return "bookmark";
  return "highlight";
}

export function parseKindleClippings(raw: string): KindleBook[] {
  const rawEntries = raw.split(ENTRY_SEPARATOR).map((e) => e.trim()).filter(Boolean);

  const entries: KindleClippingEntry[] = [];
  for (const block of rawEntries) {
    const lines = block.split(/\r?\n/);
    if (lines.length < 2) continue;

    // A leading BOM (common in this file, since Kindle writes it
    // UTF-8-with-BOM) would otherwise corrupt the very first title.
    const titleLine = lines[0].replace(/^﻿/, "");
    const metaLine = lines[1];
    const { title, author } = parseTitleLine(titleLine);
    const type = parseEntryType(metaLine);

    // Everything from line 2 onward (after the blank separator line) is
    // the clipping's own text -- absent for a bookmark, which has none.
    const text = lines.slice(2).join("\n").trim();
    if (type !== "bookmark" && !text) continue; // a highlight/note with no recovered text isn't useful

    entries.push({ bookTitle: title, author, type, text });
  }

  const byBook = new Map<string, KindleBook>();
  for (const entry of entries) {
    if (entry.type === "bookmark") continue; // no text content, nothing to import
    const key = `${entry.bookTitle}::${entry.author ?? ""}`;
    const book = byBook.get(key) ?? { title: entry.bookTitle, author: entry.author, entries: [] };
    book.entries.push(entry);
    byBook.set(key, book);
  }

  return [...byBook.values()];
}

export const KINDLE_HIGHLIGHT_COLOR: HighlightColor = "YELLOW";
