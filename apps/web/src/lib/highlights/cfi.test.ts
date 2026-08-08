import { describe, expect, it } from "vitest";
import { EpubCFI } from "epubjs";
import { compareCfi, cfiSpinePosition } from "./cfi";

/**
 * cfi.ts exists so epub.js stays out of pages that never open an EPUB, which
 * means the app now has its own CFI parser -- and a parser that is merely
 * plausible is worse than the dependency it replaced, because a mis-ordered
 * highlight list looks exactly like a correctly-ordered one.
 *
 * So this doesn't assert hand-written expectations. It runs both
 * implementations over the same corpus and requires them to agree: the real
 * EpubCFI (imported here, in a test, where its size costs nothing) and the
 * local one. Every pair in both directions, so an asymmetric bug can't hide.
 */

// Shapes that actually occur: plain point CFIs, ids in brackets, character
// offsets, text-location assertions, range CFIs, deeper paths, and later
// spine items. Ordering within this list is not asserted anywhere -- only
// that the two implementations rank them the same way.
const CORPUS = [
  "epubcfi(/6/2[cover]!/4/2/2/1:0)",
  "epubcfi(/6/4[chap01ref]!/4[body01]/2/1:0)",
  "epubcfi(/6/4[chap01ref]!/4[body01]/2/1:15)",
  "epubcfi(/6/4[chap01ref]!/4[body01]/4/1:3)",
  "epubcfi(/6/4[chap01ref]!/4[body01]/10[para05]/1:22)",
  "epubcfi(/6/4[chap01ref]!/4[body01]/10[para05]/3:1)",
  "epubcfi(/6/4[chap01ref]!/4[body01]/10[para05]/3:10[pre,post])",
  "epubcfi(/6/4[chap01ref]!/4[body01]/10[para05])",
  "epubcfi(/6/14[chap05ref]!/4[body01]/10[para05]/1:1)",
  "epubcfi(/6/14[chap05ref]!/4[body01]/10[para05]/2/1:5)",
  "epubcfi(/6/14[chap05ref]!/4[body01]/10[para05]/2/1:5,/1:2,/1:9)",
  "epubcfi(/6/14!/4/2,/2/1:1,/6/3:4)",
  "epubcfi(/6/16!/4/12/2/1:0)",
  "epubcfi(/6/246!/4/2/8/1:120)",
];

const real = new EpubCFI();

describe("compareCfi", () => {
  it("agrees with epub.js on every ordered pair in the corpus", () => {
    const disagreements: string[] = [];
    for (const a of CORPUS) {
      for (const b of CORPUS) {
        const mine = Math.sign(compareCfi(a, b));
        const theirs = Math.sign(real.compare(a, b));
        if (mine !== theirs) disagreements.push(`${a} vs ${b}: local ${mine}, epub.js ${theirs}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it("sorts a shuffled corpus into the same order epub.js does", () => {
    const shuffled = [...CORPUS].reverse();
    expect([...shuffled].sort(compareCfi)).toEqual([...shuffled].sort((a, b) => real.compare(a, b)));
  });

  it("is 0 for a CFI against itself", () => {
    for (const cfi of CORPUS) expect(compareCfi(cfi, cfi)).toBe(0);
  });

  it("survives junk without throwing", () => {
    // A highlight row is user data that has been through an import and a
    // migration; the comparator is not the place to discover it is malformed.
    for (const junk of ["", "not a cfi", "epubcfi()", "epubcfi(/6)", "epubcfi(/6/4!)"]) {
      expect(() => compareCfi(junk, CORPUS[0])).not.toThrow();
      expect(() => cfiSpinePosition(junk)).not.toThrow();
    }
  });
});

describe("cfiSpinePosition", () => {
  it("matches epub.js's spinePos for every CFI in the corpus", () => {
    for (const cfi of CORPUS) {
      expect(cfiSpinePosition(cfi)).toBe(new EpubCFI(cfi).spinePos);
    }
  });

  it("reports -1 for something that isn't a CFI, the same as epub.js", () => {
    for (const junk of ["", "not a cfi", "epubcfi(/6)"]) {
      expect(cfiSpinePosition(junk)).toBe(-1);
    }
  });
});
