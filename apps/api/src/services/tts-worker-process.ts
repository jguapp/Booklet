/**
 * Runs as its own OS process, forked by tts-pool.ts -- not a worker_thread.
 * Confirmed by hand: onnxruntime-node's native binding crashes the entire
 * Node process the moment generate() is called inside a worker_thread on
 * this platform ("Fatal error ... Check failed: maybe_code.has_value()"),
 * even though loading the model itself succeeds fine there. A real child
 * process sidesteps this completely -- it's just another independent
 * `node` invocation, exactly like the main server process, which already
 * works correctly; the isolation cost (its own V8 heap, no shared memory)
 * is what actually buys the safety here.
 *
 * One model instance lives for this process's whole lifetime (warmed
 * immediately on start, not on first message) -- same reasoning as the old
 * single-process version in tts-service.ts, just one per pool worker now
 * instead of one for the whole server.
 */
import { generateSpeech, warmTtsModel } from "./tts-service.js";

interface TtsWorkerRequest {
  id: number;
  text: string;
  voice: string;
  speed: number;
}

type TtsWorkerResponse = { id: number; buffer: Buffer } | { id: number; error: string };

void warmTtsModel();

process.on("message", (req: TtsWorkerRequest) => {
  void (async () => {
    try {
      const buffer = await generateSpeech(req.text, req.voice, req.speed);
      process.send?.({ id: req.id, buffer } satisfies TtsWorkerResponse);
    } catch (err) {
      process.send?.({ id: req.id, error: err instanceof Error ? err.message : String(err) } satisfies TtsWorkerResponse);
    }
  })();
});
