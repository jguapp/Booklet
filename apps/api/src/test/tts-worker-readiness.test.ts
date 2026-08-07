import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The pool worker reports whether its model actually loaded, and
 * /api/health surfaces that count (#161). The whole point is that health
 * should stop saying "fine" while read-aloud is dead.
 *
 * It very nearly didn't work. The worker first awaited warmTtsModel(), which
 * catches its own errors and resolves either way -- so a worker whose model
 * failed to load reported ok: true, and health reported it as loaded. Caught
 * by running the API against an unreachable weights CDN and seeing
 * `loaded: 1` for a model that had definitively failed.
 *
 * These pin the distinction, since it is invisible from the call site: both
 * functions return a promise, and only one of them means anything.
 */

const loadTtsModel = vi.fn();
const generateSpeech = vi.fn();
const warmTtsModel = vi.fn(async () => {});

vi.mock("../services/tts-service.js", () => ({ loadTtsModel, generateSpeech, warmTtsModel }));

type ReadyMessage = { type: string; ok: boolean; error?: string };

/** Imports the worker fresh (it reports readiness as a module side effect)
 * with process.send captured. */
async function startWorker(): Promise<ReadyMessage[]> {
  const sent: ReadyMessage[] = [];
  const original = process.send;
  process.send = ((msg: ReadyMessage) => {
    sent.push(msg);
    return true;
  }) as typeof process.send;

  vi.resetModules();
  await import("../services/tts-worker-process.js");
  // The report happens in a promise callback, so let the microtask queue run.
  await new Promise((r) => setTimeout(r, 0));

  process.send = original;
  return sent;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("TTS worker readiness reporting (#161)", () => {
  it("reports ok when the model loads", async () => {
    loadTtsModel.mockResolvedValueOnce({});
    const sent = await startWorker();
    expect(sent).toEqual([{ type: "ready", ok: true }]);
  });

  it("reports NOT ok when the model fails to load", async () => {
    loadTtsModel.mockRejectedValueOnce(new Error("Forbidden access to file"));
    const sent = await startWorker();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "ready", ok: false });
    expect(sent[0].error).toContain("Forbidden");
  });

  it("awaits the load that propagates failure, not the one that swallows it", async () => {
    // The actual regression: warmTtsModel resolves even when the load failed,
    // so a worker built on it can never report ok: false. Asserting which
    // function is used is the only way to pin that down -- the two are
    // indistinguishable by their return type.
    loadTtsModel.mockResolvedValueOnce({});
    await startWorker();
    expect(loadTtsModel).toHaveBeenCalledTimes(1);
    expect(warmTtsModel).not.toHaveBeenCalled();
  });
});
