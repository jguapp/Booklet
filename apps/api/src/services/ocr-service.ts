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
export class OcrWorkerPool {
  private worker: Worker | null = null;

  private async getWorker(): Promise<Worker> {
    if (!this.worker) this.worker = await createWorker("eng");
    return this.worker;
  }

  async recognize(imageBuffer: Buffer): Promise<string> {
    const worker = await this.getWorker();
    const {
      data: { text },
    } = await worker.recognize(imageBuffer);
    return text.trim();
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
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
