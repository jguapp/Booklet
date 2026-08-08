import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Highlight } from "@booklet/shared";
import { applySm2Review, DEFAULT_SM2_STATE, feedbackToQuality } from "@booklet/shared";
import { localHighlights } from "./db";

/**
 * Reading back a row that predates a field.
 *
 * IndexedDB upgrades create object stores; nothing migrates the rows already
 * inside them. So every field added since a browser last wrote a row is
 * simply absent on read, and this file's normalizeArticle/normalizeCollection
 * exist for exactly that. Highlights had no equivalent, and they are the
 * store where it does real damage: the SM-2 fields are arithmetic operands,
 * so `undefined` doesn't degrade, it produces NaN and an Invalid Date that
 * gets written back.
 */

/** A highlight as an older client would have written it: no prompt, no
 * feedback tracking, no SM-2 state. Typed loosely on purpose -- the point is
 * that these keys are missing from the stored object. */
const LEGACY_ROW = {
  id: "h-legacy",
  articleId: "a1",
  userId: "local",
  selectedText: "something worth remembering",
  position: { type: "text", exact: "something", prefix: "", suffix: "", start: 0, end: 9 },
  color: "YELLOW",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("localHighlights.getAll", () => {
  beforeEach(async () => {
    await localHighlights.clear();
  });

  it("fills in the fields a pre-SM-2 row was written without", async () => {
    await localHighlights.put(LEGACY_ROW as unknown as Highlight);

    const [read] = await localHighlights.getAll();
    expect(read.easinessFactor).toBe(DEFAULT_SM2_STATE.easinessFactor);
    expect(read.intervalDays).toBe(DEFAULT_SM2_STATE.intervalDays);
    expect(read.repetitions).toBe(DEFAULT_SM2_STATE.repetitions);
    expect(read.prompt).toBeNull();
    expect(read.surfaceCount).toBe(0);
    expect(read.lastFeedback).toBeNull();
    expect(read.nextDueAt).toBeNull();
    expect(read.annotation).toBeNull();
  });

  it("leaves such a row reviewable instead of scheduling it to NaN", async () => {
    await localHighlights.put(LEGACY_ROW as unknown as Highlight);
    const [read] = await localHighlights.getAll();

    const next = applySm2Review(
      { easinessFactor: read.easinessFactor, intervalDays: read.intervalDays, repetitions: read.repetitions },
      feedbackToQuality("REMEMBERED"),
      new Date("2026-06-01T00:00:00.000Z"),
    );
    expect(Number.isFinite(next.intervalDays)).toBe(true);
    expect(new Date(next.nextDueAt).toString()).not.toBe("Invalid Date");
  });

  it("doesn't overwrite values a current row does have", async () => {
    await localHighlights.put({
      ...(LEGACY_ROW as unknown as Highlight),
      id: "h-current",
      easinessFactor: 1.9,
      intervalDays: 12,
      repetitions: 4,
      surfaceCount: 7,
      prompt: "What does this say?",
      nextDueAt: "2026-07-01T00:00:00.000Z",
    });

    const read = (await localHighlights.getAll()).find((h) => h.id === "h-current")!;
    expect(read.easinessFactor).toBe(1.9);
    expect(read.intervalDays).toBe(12);
    expect(read.repetitions).toBe(4);
    expect(read.surfaceCount).toBe(7);
    expect(read.prompt).toBe("What does this say?");
    expect(read.nextDueAt).toBe("2026-07-01T00:00:00.000Z");
  });
});
