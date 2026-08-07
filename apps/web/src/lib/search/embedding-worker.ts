/// <reference lib="webworker" />
/**
 * Runs all-MiniLM-L6-v2 off the main thread for local semantic search (#156).
 *
 * A Worker is not a nicety here. Embedding is dense WASM matrix maths that
 * runs for tens of milliseconds per chunk and for minutes across a library;
 * on the main thread that is a frozen page -- no scrolling, no typing in the
 * search box the work exists to serve. Everything below therefore stays
 * inside the worker, and only finished vectors cross back.
 *
 * The same model and settings as the server (apps/api's embedding-service):
 * mean pooling, normalized, 384 dimensions. That is deliberate -- local and
 * signed-in mode are supposed to produce comparable results, and they only do
 * if both sides embed into the same space.
 *
 * The protocol is request/response with an explicit id rather than a plain
 * message: indexing and querying are both in flight at once (a search fires
 * while a rebuild is still running), so replies have to be matched to their
 * request rather than assumed to arrive in order.
 */
import { type FeatureExtractionPipeline, env, pipeline } from "@huggingface/transformers";

export const EMBEDDING_MODEL_ID = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMENSIONS = 384;

export type EmbeddingRequest = { id: number; texts: string[] };
export type EmbeddingResponse =
  | { id: number; ok: true; vectors: Float32Array[] }
  | { id: number; ok: false; error: string };

// Fetch weights from the Hub rather than looking for a local copy first --
// there is no local copy in a browser, and leaving this on would make every
// load pay a failing request to our own origin before falling back.
env.allowLocalModels = false;

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

/** Cached across messages: loading is a ~25MB download plus WASM compilation,
 * so doing it per request would dominate everything else by orders of
 * magnitude. Cleared on failure so a download that failed once (offline, a
 * flaky network) can be retried rather than poisoning the worker for the rest
 * of the session. */
function loadPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = pipeline("feature-extraction", EMBEDDING_MODEL_ID).catch((err) => {
      pipelinePromise = null;
      throw err;
    });
  }
  return pipelinePromise;
}

async function embed(texts: string[]): Promise<Float32Array[]> {
  const extractor = await loadPipeline();
  // Mean pooling over tokens, then normalized to unit length -- which is what
  // lets the consumers use a plain dot product and what the stored vectors are
  // assumed to satisfy.
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  const flat = output.data as Float32Array;

  // The tensor comes back as one contiguous [n, dims] buffer; slice it back
  // into per-text vectors. `.slice` copies rather than viewing, which matters
  // because these are about to be transferred -- a set of views onto one
  // buffer would transfer as one shared buffer and alias each other.
  const vectors: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    vectors.push(flat.slice(i * EMBEDDING_DIMENSIONS, (i + 1) * EMBEDDING_DIMENSIONS));
  }
  return vectors;
}

self.addEventListener("message", (event: MessageEvent<EmbeddingRequest>) => {
  const { id, texts } = event.data;
  void embed(texts).then(
    (vectors) => {
      // Transferred, not copied: a batch is a few hundred KB of Float32Array
      // and structured-cloning it would double the allocation for no reason.
      // Safe because the worker drops every reference to them right here.
      const response: EmbeddingResponse = { id, ok: true, vectors };
      self.postMessage(
        response,
        vectors.map((v) => v.buffer),
      );
    },
    (err: unknown) => {
      // Errors are reported as messages rather than thrown. An uncaught throw
      // in a worker surfaces as an 'error' event with no way to tell which
      // request failed, which would hang every other request's promise.
      const response: EmbeddingResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
      self.postMessage(response);
    },
  );
});
