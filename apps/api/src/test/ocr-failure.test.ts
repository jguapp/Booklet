import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression cover for #163: a failed trained-data download used to take the
 * whole API process down with it.
 *
 * tesseract.js reports worker failures from inside its own message callback,
 * and with no errorHandler installed its fallback is a bare `throw` on that
 * callback's stack -- unreachable by any caller's try/catch and by any
 * promise rejection, so Node treats it as an uncaught exception and exits.
 * Observed for real: the CDN fetch for eng.traineddata.gz returned 403 and
 * killed the server mid-request, after which every later request in that run
 * failed for want of an API rather than for anything to do with OCR.
 *
 * ocr.test.ts exercises real recognition and so can only observe this where
 * the CDN is actually unreachable. These tests stub tesseract.js instead, so
 * the containment is asserted the same way everywhere.
 */

type ErrorHandler = (err: unknown) => void;

const state: {
  errorHandler: ErrorHandler | null;
  mode: "fail-on-load" | "fail-on-recognize" | "ok";
  createCalls: number;
} = { errorHandler: null, mode: "ok", createCalls: 0 };

vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(async (_langs?: unknown, _oem?: unknown, options?: { errorHandler?: ErrorHandler }) => {
    state.createCalls++;
    state.errorHandler = options?.errorHandler ?? null;

    if (state.mode === "fail-on-load") {
      // Exactly the shape that caused the outage: the handler is invoked and
      // the promise createWorker() returned never settles at all. Awaiting it
      // alone would hang forever, which is why the implementation races it.
      state.errorHandler?.(new Error("Network error while fetching eng.traineddata.gz. Response code: 403"));
      return new Promise(() => {}) as never;
    }

    return {
      recognize: vi.fn(async () => {
        if (state.mode === "fail-on-recognize") {
          state.errorHandler?.(new Error("worker died mid-job"));
          // Resolves despite the failure -- also a real tesseract.js shape,
          // and why recognize() cannot just trust its own return value.
          return { data: { text: "" } };
        }
        return { data: { text: "  Hello Booklet  " } };
      }),
      terminate: vi.fn(async () => {}),
    } as never;
  }),
}));

const { OcrError, OcrWorkerPool } = await import("../services/ocr-service.js");

describe("OcrWorkerPool failure containment (#163)", () => {
  beforeEach(() => {
    state.errorHandler = null;
    state.mode = "ok";
    state.createCalls = 0;
  });

  it("rejects rather than crashing when the trained-data download fails", async () => {
    state.mode = "fail-on-load";
    const pool = new OcrWorkerPool();
    await expect(pool.recognize(Buffer.from("x"))).rejects.toBeInstanceOf(OcrError);
  });

  it("does not hang when createWorker's own promise never settles", async () => {
    state.mode = "fail-on-load";
    const pool = new OcrWorkerPool();
    // The bug being guarded is an await that never returns; a real timeout
    // here would fail the test rather than pass it.
    const outcome = await Promise.race([
      pool.recognize(Buffer.from("x")).then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 2000)),
    ]);
    expect(outcome).toBe("rejected");
  });

  it("surfaces a failure reported during recognition, even though the call resolved", async () => {
    state.mode = "fail-on-recognize";
    const pool = new OcrWorkerPool();
    await expect(pool.recognize(Buffer.from("x"))).rejects.toBeInstanceOf(OcrError);
  });

  it("builds a fresh worker after a failure instead of reusing the dead one", async () => {
    state.mode = "fail-on-load";
    const pool = new OcrWorkerPool();
    await expect(pool.recognize(Buffer.from("x"))).rejects.toBeInstanceOf(OcrError);
    expect(state.createCalls).toBe(1);

    // A trained-data fetch that 403s once can succeed later, so the pool has
    // to be willing to try again rather than staying poisoned for the life of
    // the process.
    state.mode = "ok";
    await expect(pool.recognize(Buffer.from("x"))).resolves.toBe("Hello Booklet");
    expect(state.createCalls).toBe(2);
  });

  it("starts the worker once when two recognitions race", async () => {
    state.mode = "ok";
    const pool = new OcrWorkerPool();
    const [a, b] = await Promise.all([pool.recognize(Buffer.from("x")), pool.recognize(Buffer.from("y"))]);
    expect(a).toBe("Hello Booklet");
    expect(b).toBe("Hello Booklet");
    expect(state.createCalls).toBe(1);
  });
});
