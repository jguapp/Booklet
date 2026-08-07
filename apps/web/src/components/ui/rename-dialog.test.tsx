import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RenameDialog } from "./rename-dialog";

/**
 * The first test that renders a real React component (#166). Its value is as
 * much that it runs at all as what it asserts: rendering was blocked because
 * @testing-library/react could not resolve the same React instance the
 * components use, which fails either as a bare "Cannot read properties of
 * null (reading 'useState')" or -- worse -- by silently rendering an empty
 * container and passing a weak assertion.
 *
 * RenameDialog rather than something simpler is the deliberate choice.
 * A component with no hooks renders fine across two React copies, so a
 * hookless test would go green while proving nothing; hooks are what read
 * the shared internal dispatcher a second copy breaks. This one uses
 * useState, useRef, useEffect and createPortal (i.e. react-dom too, which is
 * the half that was version-mismatched), so it fails loudly if the
 * resolution regresses.
 *
 * It also covers real behaviour worth pinning: Save stays disabled until the
 * title actually changes, which is what stops a no-op rename firing a
 * request. See #146 for the feature.
 */
describe("RenameDialog", () => {
  const base = {
    title: "Rename article",
    label: "Title",
    initialValue: "Original title",
    onConfirm: () => {},
    onCancel: () => {},
  };

  it("renders into a portal with the current title pre-filled", () => {
    render(<RenameDialog {...base} />);
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Original title");
  });

  it("keeps Save disabled until the title actually changes", () => {
    render(<RenameDialog {...base} />);
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    // Unchanged -- and whitespace-only edits still count as unchanged.
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  Original title  " } });
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "A new title" } });
    expect(save.disabled).toBe(false);
  });

  it("confirms with the trimmed title", () => {
    const onConfirm = vi.fn();
    render(<RenameDialog {...base} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  Trimmed me  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onConfirm).toHaveBeenCalledWith("Trimmed me");
  });

  it("cancels on Escape", () => {
    const onCancel = vi.fn();
    render(<RenameDialog {...base} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });
});
