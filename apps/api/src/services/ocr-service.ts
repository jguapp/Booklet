import { createWorker, type Worker } from "tesseract.js";

/**
 * Tesseract.js (WASM, runs in-process -- no external API, no per-request
 * cost) rather than a cloud OCR service. Meaningfully behind Google
 * Vision/AWS Textract/Azure on accuracy, but it's the right tradeoff for a
 * first version: no new billing relationship or API key requirement,
 * consistent with how this app has avoided paid external dependencies
 * everywhere except where genuinely unavoidable (see the translation
 * issue, which has no equivalent free option).
 *
 * One worker is created per call site and reused across every page of a
 * document (worker startup -- loading the WASM engine + trained data --
 * dominates the cost of a single recognition, so amortizing it across
 * pages matters far more than parallelizing pages against fresh workers).
 */
/** A failed recognition, as an ordinary rejected promise the caller can
 * handle -- see the errorHandler below for why this type has to exist. */
export class OcrError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "OcrError";
  }
}

export class OcrWorkerPool {
  /** The in-flight or settled worker startup, not the worker itself: two
   * concurrent recognize() calls both used to find `worker === null` and each
   * build their own, leaking one of them (and paying WASM startup twice).
   * Sharing the promise makes startup happen exactly once. */
  private startup: Promise<Worker> | null = null;
  private worker: Worker | null = null;

  private async getWorker(): Promise<Worker> {
    if (this.startup) return this.startup;
    {
      // errorHandler is not optional in practice. tesseract.js reports worker
      // failures from inside its own message callback, and with no handler
      // installed its fallback is a bare `throw` on that callback's stack
      // (createWorker.js) -- which no caller's try/catch and no promise
      // rejection can reach, so it lands as an uncaught exception and takes
      // the entire API process down. Observed for real: the trained-data
      // download (a CDN fetch, on a path with no retry) returning 403 killed
      // the server mid-request, and every subsequent request in that e2e run
      // failed for want of an API rather than for anything to do with OCR
      // (#163). Installing a handler routes it back into normal control flow.
      //
      // The handler doesn't just record the failure, it actively rejects the
      // startup. tesseract.js does not reliably settle the promise
      // createWorker() returned when the failure happens during trained-data
      // load -- it rejects whichever internal job it associated the message
      // with, which is not necessarily that one. Awaiting createWorker() alone
      // therefore hangs rather than throwing (confirmed: a 30s test timeout
      // instead of an error), so the handler is raced against it.
      let failStartup: (err: unknown) => void = () => {};
      const failed = new Promise<never>((_, reject) => {
        failStartup = reject;
      });

      const created = createWorker("eng", undefined, {
        errorHandler: (err: unknown) => {
          const failure = new OcrError(
            `OCR worker failed: ${err instanceof Error ? err.message : String(err)}`,
            err,
          );
          this.failure = failure;
          // A worker that reported an error is not reusable -- drop it so the
          // next call builds a fresh one instead of inheriting a dead one.
          // (A trained-data fetch that 403s once may well succeed later.)
          this.reset();
          failStartup(failure);
        },
      });

      // Unhandled-rejection guard: whichever of the two loses the race still
      // settles, and an un-awaited rejected promise is itself a process-level
      // crash in Node.
      failed.catch(() => {});
      created.catch(() => {});

      this.startup = Promise.race([created, failed])
        .then((worker) => {
          this.worker = worker;
          return worker;
        })
        .catch((err) => {
          this.reset();
          throw err instanceof OcrError
            ? err
            : new OcrError(`OCR worker could not start: ${err instanceof Error ? err.message : String(err)}`, err);
        });
      return this.startup;
    }
  }

  /** Set by errorHandler, which is invoked out-of-band rather than on the
   * awaiting call's own stack -- so recognize() checks it to turn an
   * asynchronous worker failure into a rejection of the right call. */
  private failure: OcrError | null = null;

  private reset(): void {
    this.startup = null;
    this.worker = null;
  }

  async recognize(imageBuffer: Buffer): Promise<string> {
    this.failure = null;
    let worker: Worker;
    try {
      worker = await this.getWorker();
    } catch (err) {
      throw err instanceof OcrError ? err : new OcrError("OCR worker could not start", err);
    }

    try {
      const {
        data: { text },
      } = await worker.recognize(imageBuffer);
      // recognize() can resolve even though errorHandler fired for this job,
      // so a failure recorded during it still has to surface.
      if (this.failure) throw this.failure;
      return text.trim();
    } catch (err) {
      this.reset();
      throw err instanceof OcrError ? err : new OcrError("OCR failed", err);
    }
  }

  async terminate(): Promise<void> {
    const worker = this.worker;
    this.reset();
    if (worker) {
      // Terminating a worker that already failed can itself throw; that is
      // cleanup, not something worth propagating over the original error.
      await worker.terminate().catch(() => {});
    }
  }
}

// Shared across every OCR'd upload for the life of the process, not one per
// request. pdf-extraction.ts used to create-and-terminate a fresh
// OcrWorkerPool inside every request that needed OCR -- correct on its own
// terms (a pool reused across one document's pages), but it discarded the
// expensive part (worker startup: loading the WASM engine + trained data,
// multiple seconds) at the end of every single request, paying it again on
// the very next upload. A held-open worker costs real, bounded memory for
// the process's lifetime; that's the right trade against paying a multi-
// second tax on every OCR'd PDF, which is what "near instant" upload
// actually depends on.
let sharedPool: OcrWorkerPool | null = null;

export function getSharedOcrPool(): OcrWorkerPool {
  if (!sharedPool) sharedPool = new OcrWorkerPool();
  return sharedPool;
}
