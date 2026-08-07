import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fire, getByTitle, queryByTitle, render } from "@/test/render";
import { HighlightPopover } from "./highlight-popover";

// The popover reads the highlight bar's colors from device prefs; the real
// provider pulls in IndexedDB and the API client, neither of which any of this
// behavior depends on.
vi.mock("@/lib/data/device-prefs-provider", () => ({
  useDevicePrefs: () => ({ reader: { highlightBarColors: ["YELLOW", "GREEN", "BLUE"] } }),
}));

// Dictionary lookup is a network call behind a "Look up" affordance none of
// these tests touch.
vi.mock("@/lib/dictionary", () => ({
  isLookupableWord: () => false,
  lookupWord: vi.fn(),
}));

afterEach(cleanup);

const anchorRect = {
  top: 100,
  left: 50,
  width: 120,
  height: 20,
  bottom: 120,
  right: 170,
  x: 50,
  y: 100,
  toJSON: () => ({}),
} as DOMRect;

function renderPopover(overrides: Partial<{ onConfirm: () => void; onDismiss: () => void }> = {}) {
  const onDismiss = overrides.onDismiss ?? vi.fn();
  const onConfirm = overrides.onConfirm ?? vi.fn();
  render(
    <HighlightPopover anchorRect={anchorRect} selectedText="some text" onConfirm={onConfirm} onDismiss={onDismiss} />,
  );
  return { onDismiss, onConfirm };
}

// jsdom's window.scrollY is a non-writable accessor, so a plain assignment
// silently does nothing -- which would make every "should not dismiss" case
// below pass for the wrong reason (delta always zero) while every "should
// dismiss" one failed. defineProperty is what actually moves it.
function setScrollY(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true, writable: true });
}

function scrollTo(y: number) {
  fire(() => {
    setScrollY(y);
    window.dispatchEvent(new Event("scroll"));
  });
}

/**
 * Regression cover for the last intermittent failure in the re-enabled e2e
 * suite (highlight-citations.spec.ts, timing out on the colour picker).
 *
 * The popover dismissed itself on *any* window scroll event. But "a scroll
 * event arrived" and "the page has moved since this opened" are different
 * things: a scroll event can be dispatched a frame or more after the scrolling
 * that caused it -- a programmatic scrollIntoView, or ordinary momentum
 * scrolling, which keeps emitting for hundreds of milliseconds after the
 * fingers leave the trackpad. Either can land just after the popover mounts,
 * for scrolling that finished before it existed, closing the popover the
 * reader just opened.
 *
 * It reproduced about one run in three and cost a full e2e cycle to find.
 * These run in milliseconds -- and unlike the extracted-predicate version they
 * replace, they exercise the real listener on a real mounted component, so
 * they would also catch the listener being wired up wrongly or not at all.
 */
describe("HighlightPopover scroll dismissal", () => {
  it("ignores a scroll event reporting the position the page is already at", () => {
    setScrollY(500);
    const { onDismiss } = renderPopover();
    scrollTo(500);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("ignores sub-threshold jitter", () => {
    setScrollY(500);
    const { onDismiss } = renderPopover();
    scrollTo(502);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("dismisses on a real scroll down", () => {
    setScrollY(500);
    const { onDismiss } = renderPopover();
    scrollTo(900);
    expect(onDismiss).toHaveBeenCalled();
  });

  it("dismisses on a real scroll up", () => {
    setScrollY(500);
    const { onDismiss } = renderPopover();
    scrollTo(100);
    expect(onDismiss).toHaveBeenCalled();
  });

  it("measures from where the popover opened, not the top of the page", () => {
    // Comparing against 0 instead of the mount position would dismiss
    // instantly on any deep-scrolled page -- which is most of them, since you
    // have to scroll to reach the text you want to highlight.
    setScrollY(5000);
    const { onDismiss } = renderPopover();
    scrollTo(5000);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", () => {
    setScrollY(0);
    const onDismiss = vi.fn();
    const { unmount } = render(
      <HighlightPopover anchorRect={anchorRect} selectedText="t" onConfirm={vi.fn()} onDismiss={onDismiss} />,
    );
    unmount();
    scrollTo(900);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe("HighlightPopover, the rest of the surface", () => {
  it("renders one swatch per configured highlight colour", () => {
    renderPopover();
    expect(queryByTitle("Yellow")).not.toBeNull();
    expect(queryByTitle("Green")).not.toBeNull();
    expect(queryByTitle("Blue")).not.toBeNull();
  });

  it("confirms with the colour that was clicked", () => {
    const { onConfirm } = renderPopover();
    fire(() => getByTitle("Green").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onConfirm).toHaveBeenCalledWith("GREEN", "");
  });

  it("dismisses on Escape", () => {
    const { onDismiss } = renderPopover();
    fire(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("dismisses on a pointer press outside itself", () => {
    const { onDismiss } = renderPopover();
    fire(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("does not dismiss on a press inside itself", () => {
    const { onDismiss } = renderPopover();
    fire(() => getByTitle("Yellow").dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
