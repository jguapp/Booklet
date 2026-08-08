/**
 * Just enough EPUB CFI parsing to sort highlights and name their section --
 * the only two things anything outside the EPUB reader ever asks of a CFI.
 *
 * This exists to keep epub.js out of pages that never open an EPUB. It is a
 * ~500KB dependency (epub.js plus the JSZip it pulls with it), and importing
 * `EpubCFI` from it here put all of that in the initial JavaScript of
 * /highlights, /resurface and every reader page, whatever the article was --
 * measured at 485KB of a 1.2MB page load, for two functions that do nothing
 * but read numbers out of a string. The reader itself still uses the real
 * library (it needs the rest of it anyway), loaded on demand by next/dynamic.
 *
 * Both functions below are ports of epub.js's own (parse/parseComponent/
 * parseStep/parseTerminal/compare in epubcfi.js), deliberately kept in the
 * same shape so they can be read side by side. cfi.test.ts checks them
 * against the real implementation over a corpus of CFIs rather than against
 * hand-written expectations -- a hand-rolled parser that merely looks right
 * is exactly how a highlight list ends up subtly mis-ordered with nobody
 * noticing.
 *
 * A CFI: epubcfi(/6/14[chap05]!/4[body]/10[para05]/1:22)
 *                ^^^^^^^^^^^^^ base (spine)
 *                              ^^^^^^^^^^^^^^^^^^^ path within the document
 *                                                    ^^ terminal offset
 * and a range CFI has two more comma-separated components after the path.
 */

interface Step {
  index: number;
}

interface Component {
  steps: Step[];
  /** Character offset into the addressed text node, or null for an element. */
  offset: number | null;
}

interface ParsedCfi {
  /** Index of the spine item (the chapter), or -1 when unparseable. */
  spinePos: number;
  /** Steps and terminal of the range's *start*, or of the path itself when
   * the CFI addresses a single point. What comparison is done against. */
  steps: Step[];
  offset: number | null;
}

/** A step's number is even for an element and odd for a text node; the index
 * they encode is the position among siblings of that kind. Same arithmetic as
 * epub.js's parseStep -- a wrong halving here would order siblings correctly
 * anyway (the mapping is monotonic), but it keeps the two readable together. */
function parseStep(stepStr: string): Step | null {
  const num = parseInt(stepStr, 10);
  if (Number.isNaN(num)) return null;
  return { index: num % 2 === 0 ? num / 2 - 1 : (num - 1) / 2 };
}

function parseComponent(componentStr: string): Component {
  const [stepsPart, terminalPart] = componentStr.split(":");
  const rawSteps = stepsPart.split("/");
  if (rawSteps[0] === "") rawSteps.shift(); // leading slash
  const steps = rawSteps.map(parseStep).filter((s): s is Step => s !== null);

  let offset: number | null = null;
  if (terminalPart !== undefined) {
    // A terminal can carry a text-location assertion: "22[pre,post]".
    const parsed = parseInt(terminalPart.split("[")[0], 10);
    if (!Number.isNaN(parsed)) offset = parsed;
  }
  return { steps, offset };
}

export function parseCfi(cfiStr: string): ParsedCfi {
  const empty: ParsedCfi = { spinePos: -1, steps: [], offset: null };
  if (typeof cfiStr !== "string") return empty;

  let body = cfiStr;
  if (body.startsWith("epubcfi(") && body.endsWith(")")) body = body.slice(8, -1);

  const [baseStr, afterIndirection] = body.split("!");
  if (!baseStr) return empty;
  const base = parseComponent(baseStr);
  // epub.js reads the spine position off the base's *second* step and nothing
  // else; a base with fewer steps is not a document-addressing CFI.
  if (base.steps.length < 2) return empty;

  const commaParts = body.split(",");
  const isRange = commaParts.length === 3;
  const pathStr = afterIndirection ? afterIndirection.split(",")[0] : "";
  const path = pathStr ? parseComponent(pathStr) : { steps: [], offset: null };

  if (!isRange) return { spinePos: base.steps[1].index, steps: path.steps, offset: path.offset };

  // Range: compare by where it starts, which is path + the start component.
  const start = parseComponent(commaParts[1]);
  return {
    spinePos: base.steps[1].index,
    steps: [...path.steps, ...start.steps],
    offset: start.offset,
  };
}

/** Which spine item (chapter) a CFI points into, or -1. */
export function cfiSpinePosition(cfiStr: string): number {
  return parseCfi(cfiStr).spinePos;
}

/** Document order: negative if `a` comes first, matching Array#sort's
 * contract and epub.js's EpubCFI#compare. */
export function compareCfi(a: string, b: string): number {
  const one = parseCfi(a);
  const two = parseCfi(b);
  if (one.spinePos !== two.spinePos) return one.spinePos > two.spinePos ? 1 : -1;

  for (let i = 0; i < one.steps.length; i++) {
    // A shorter path is the less specific address, and epub.js treats less
    // specific as earlier.
    if (!two.steps[i]) return 1;
    if (one.steps[i].index !== two.steps[i].index) return one.steps[i].index > two.steps[i].index ? 1 : -1;
  }
  if (one.steps.length < two.steps.length) return -1;

  const offsetOne = one.offset ?? 0;
  const offsetTwo = two.offset ?? 0;
  if (offsetOne !== offsetTwo) return offsetOne > offsetTwo ? 1 : -1;
  return 0;
}
