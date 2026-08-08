import { afterEach, describe, expect, it, vi } from "vitest";
import type { Highlight } from "@booklet/shared";
import { cleanup, fire, getByTitle, queryByTitle, render } from "@/test/render";
import { HighlightListItem } from "./highlight-list-item";

/**
 * Recall prompts (#157). Resurfacing used to show the passage and then ask
 * whether you remembered it, which grades recognition rather than recall --
 * so the REMEMBERED/FORGOT feedback going into SM-2 was measuring the wrong
 * thing. A prompted highlight now conceals its passage until the reader asks
 * for it.
 *
 * The concealment rule is worth pinning down here rather than only in
 * Playwright, because "the answer leaked" is a silent failure: a card that
 * renders too much still renders, still grades, and still looks right in a
 * screenshot. Only an assertion that the text is *absent* catches it.
 */

const BASE: Highlight = {
  id: "h1",
  articleId: "a1",
  userId: "local",
  selectedText: "the answer to everything",
  position: { type: "text", exact: "the answer", prefix: "", suffix: "", start: 0, end: 10 },
  color: "YELLOW",
  prompt: null,
  lastSurfacedAt: null,
  surfaceCount: 0,
  lastFeedback: null,
  lastFeedbackAt: null,
  resurfaceArchivedAt: null,
  easinessFactor: 2.5,
  intervalDays: 0,
  repetitions: 0,
  nextDueAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  annotation: null,
};

function text(): string {
  return document.body.textContent ?? "";
}

function buttonWithText(label: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  if (!match) throw new Error(`no button labelled ${JSON.stringify(label)}`);
  return match as HTMLButtonElement;
}

function click(el: HTMLElement) {
  fire(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

/** React tracks a controlled input's value on the DOM node itself, so a plain
 * `el.value = x` is overwritten before the change event is read. Going through
 * the prototype's setter is what makes React see the edit. */
function type(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  fire(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function textarea(): HTMLTextAreaElement {
  const el = document.body.querySelector("textarea");
  if (!el) throw new Error("no textarea rendered");
  return el;
}

afterEach(cleanup);

describe("HighlightListItem concealment", () => {
  it("shows the prompt and withholds the passage when concealed", () => {
    render(<HighlightListItem highlight={{ ...BASE, prompt: "What is it?" }} concealed onReveal={vi.fn()} />);
    expect(text()).toContain("What is it?");
    expect(text()).not.toContain("the answer to everything");
  });

  it("withholds the note too -- a note usually paraphrases the passage", () => {
    render(
      <HighlightListItem
        highlight={{
          ...BASE,
          prompt: "What is it?",
          annotation: {
            id: "n1",
            highlightId: "h1",
            userId: "local",
            noteText: "it's forty-two",
            createdAt: BASE.createdAt,
            updatedAt: BASE.updatedAt,
          },
        }}
        concealed
        onReveal={vi.fn()}
      />,
    );
    expect(text()).not.toContain("it's forty-two");
  });

  it("reveals on demand", () => {
    const onReveal = vi.fn();
    render(<HighlightListItem highlight={{ ...BASE, prompt: "What is it?" }} concealed onReveal={onReveal} />);
    click(buttonWithText("Show the highlight"));
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  // Concealment is the caller's state, not the component's: Daily Review owns
  // the revealed set (keyed by highlight id, so it can't leak across cards)
  // and re-renders with concealed=false. Asserting the un-concealed render
  // here is what pins the other half of that contract.
  it("shows prompt and passage together once no longer concealed", () => {
    render(<HighlightListItem highlight={{ ...BASE, prompt: "What is it?" }} concealed={false} />);
    expect(text()).toContain("What is it?");
    expect(text()).toContain("the answer to everything");
  });

  // The case that keeps this additive: every highlight saved before #157 has
  // prompt === null, and there is no question to put in the passage's place.
  // Concealing one would show an empty card with a reveal button.
  it("ignores concealment for a highlight with no prompt", () => {
    render(<HighlightListItem highlight={BASE} concealed onReveal={vi.fn()} />);
    expect(text()).toContain("the answer to everything");
    expect(document.body.textContent).not.toContain("Show the highlight");
  });
});

describe("HighlightListItem prompt editing", () => {
  it("offers to add a prompt only when there isn't one and a handler is wired", () => {
    const { unmount } = render(<HighlightListItem highlight={BASE} onSavePrompt={vi.fn()} />);
    expect(text()).toContain("+ Add a recall prompt");
    unmount();

    render(<HighlightListItem highlight={BASE} />);
    expect(text()).not.toContain("+ Add a recall prompt");
  });

  it("does not offer to add one when the highlight already has a prompt", () => {
    render(<HighlightListItem highlight={{ ...BASE, prompt: "What is it?" }} onSavePrompt={vi.fn()} />);
    expect(text()).not.toContain("+ Add a recall prompt");
    expect(queryByTitle("Edit prompt")).not.toBeNull();
  });

  it("saves a typed prompt, trimmed", () => {
    const onSavePrompt = vi.fn();
    render(<HighlightListItem highlight={BASE} onSavePrompt={onSavePrompt} />);
    click(buttonWithText("+ Add a recall prompt"));
    type(textarea(), "  Why does this matter?  ");
    click(buttonWithText("Save"));
    expect(onSavePrompt).toHaveBeenCalledWith("h1", "Why does this matter?");
  });

  // Emptying the box and saving removes the prompt rather than storing "",
  // matching how the note field above it already behaves -- and matching
  // normalizeRecallPrompt, so the client and the API agree on what an empty
  // prompt means.
  it("removes the prompt when the box is emptied and saved", () => {
    const onSavePrompt = vi.fn();
    const onDeletePrompt = vi.fn();
    render(
      <HighlightListItem
        highlight={{ ...BASE, prompt: "What is it?" }}
        onSavePrompt={onSavePrompt}
        onDeletePrompt={onDeletePrompt}
      />,
    );
    click(getByTitle("Edit prompt"));
    type(textarea(), "   ");
    click(buttonWithText("Save"));
    expect(onDeletePrompt).toHaveBeenCalledWith("h1");
    expect(onSavePrompt).not.toHaveBeenCalled();
  });

  it("discards an edit on cancel", () => {
    const onSavePrompt = vi.fn();
    render(<HighlightListItem highlight={{ ...BASE, prompt: "What is it?" }} onSavePrompt={onSavePrompt} />);
    click(getByTitle("Edit prompt"));
    type(textarea(), "something else");
    click(buttonWithText("Cancel"));
    expect(onSavePrompt).not.toHaveBeenCalled();
    expect(text()).toContain("What is it?");
  });

  it("offers no prompt editing while concealed -- that's reviewing, not editing", () => {
    render(
      <HighlightListItem
        highlight={{ ...BASE, prompt: "What is it?" }}
        concealed
        onReveal={vi.fn()}
        onSavePrompt={vi.fn()}
        onDeletePrompt={vi.fn()}
      />,
    );
    expect(queryByTitle("Edit prompt")).toBeNull();
    expect(queryByTitle("Remove prompt")).toBeNull();
  });
});
