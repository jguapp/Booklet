/**
 * Word lookup for the reader's selection popover (see HighlightPopover) --
 * Apple Books-style "look up a word without leaving the page". Free,
 * no-API-key, CORS-open public API (dictionaryapi.dev), called directly
 * from the browser: unlike article/file extraction, the word being looked
 * up isn't a user-supplied URL, so there's no SSRF surface that would
 * require routing this through our own server instead.
 */

export interface DictionaryMeaning {
  partOfSpeech: string;
  definition: string;
  example: string | null;
}

export interface DictionaryEntry {
  word: string;
  phonetic: string | null;
  meanings: DictionaryMeaning[];
}

interface RawDefinition {
  definition: string;
  example?: string;
}

interface RawMeaning {
  partOfSpeech: string;
  definitions: RawDefinition[];
}

interface RawEntry {
  word: string;
  phonetic?: string;
  phonetics?: { text?: string }[];
  meanings: RawMeaning[];
}

const MAX_MEANINGS = 4;

/** A selection is worth looking up if it's a single word, not a phrase/sentence. */
export function isLookupableWord(selectedText: string): boolean {
  const trimmed = selectedText.trim();
  return trimmed.length > 0 && trimmed.length <= 40 && /^[a-zA-Z''-]+$/.test(trimmed);
}

export async function lookupWord(word: string): Promise<DictionaryEntry | null> {
  const trimmed = word.trim().toLowerCase();
  if (!trimmed) return null;

  let res: globalThis.Response;
  try {
    res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(trimmed)}`);
  } catch {
    throw new Error("Couldn't reach the dictionary. Check your connection.");
  }

  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Couldn't reach the dictionary. Check your connection.");

  const entries = (await res.json()) as RawEntry[];
  const first = entries[0];
  if (!first) return null;

  const phonetic = first.phonetic?.trim() || first.phonetics?.find((p) => p.text)?.text?.trim() || null;

  const meanings: DictionaryMeaning[] = [];
  for (const meaning of first.meanings) {
    for (const def of meaning.definitions) {
      if (meanings.length >= MAX_MEANINGS) break;
      meanings.push({
        partOfSpeech: meaning.partOfSpeech,
        definition: def.definition,
        example: def.example?.trim() || null,
      });
    }
    if (meanings.length >= MAX_MEANINGS) break;
  }

  return { word: first.word, phonetic, meanings };
}
