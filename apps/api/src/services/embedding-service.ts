/**
 * Sentence embeddings for semantic search (#156), via all-MiniLM-L6-v2 under
 * transformers.js.
 *
 * This adds a model, not a stack: @huggingface/transformers is already a
 * direct dependency (it is what kokoro-js runs on), and the same library runs
 * in Node here and under WASM in the browser -- which is what lets signed-in
 * and local mode produce comparable results rather than one being a
 * second-class approximation of the other.
 *
 * Why local rather than a hosted embeddings API: an API would be better at
 * the task and would also break the two things this app actually promises --
 * that local/anonymous mode behaves the same as signed-in mode, and that
 * nothing external is required. MiniLM is meaningfully weaker than a large
 * hosted model. It is still an enormous improvement over "the article does
 * not contain that word, so it does not exist".
 */
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

/** ~25MB quantized. Must match the model the browser side loads, or the two
 * halves of #156 would embed into different vector spaces and their scores
 * would be meaningless against each other. */
export const EMBEDDING_MODEL_ID = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMENSIONS = 384;

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * One pipeline for the process's lifetime -- loading is the expensive part and
 * must never happen inside a request. Same reasoning as tts-service.ts's model
 * handle, and the same failure handling: a rejected load is not cached, so a
 * transient fetch failure does not poison every later call for as long as the
 * process lives.
 */
export function loadEmbeddingModel(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = pipeline("feature-extraction", EMBEDDING_MODEL_ID, { dtype: "q8" }).catch((err: unknown) => {
      pipelinePromise = null;
      throw err;
    });
  }
  return pipelinePromise;
}

/** Warms the model at startup so the first search does not pay for it. Logs
 * rather than throws: semantic search being briefly unavailable must not stop
 * the API from serving everything else, exactly as warmTtsPool does. */
export async function warmEmbeddingModel(): Promise<void> {
  try {
    await loadEmbeddingModel();
  } catch (err) {
    console.error("[embeddings] failed to warm the model at startup:", err);
  }
}

/**
 * Embeds one or more texts, returning unit-length vectors.
 *
 * `pooling: "mean"` collapses per-token vectors into one per text -- MiniLM
 * emits a vector per token, and the sentence-level embedding everyone means
 * by "the embedding" is their mean. `normalize: true` makes them unit length,
 * which is what lets cosine similarity be compared across texts at all.
 * cosineSimilarity in packages/shared still divides by magnitude rather than
 * trusting this, since the failure mode of a wrong assumption there is
 * silently wrong ordering rather than an error.
 */
export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const extractor = await loadEmbeddingModel();
  const output = await extractor(texts, { pooling: "mean", normalize: true });

  // transformers.js returns one [texts.length, dims] tensor, not an array of
  // vectors -- slicing it back apart is on us.
  const flat = output.data as Float32Array;
  const dims = output.dims.at(-1) ?? EMBEDDING_DIMENSIONS;
  const vectors: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    vectors.push(Float32Array.from(flat.slice(i * dims, (i + 1) * dims)));
  }
  return vectors;
}

/** Embeds a single text. Separate from embedTexts only for call-site clarity;
 * batching is strictly faster per item, so anything embedding a whole article
 * should use embedTexts. */
export async function embedText(text: string): Promise<Float32Array> {
  const [vector] = await embedTexts([text]);
  return vector;
}
