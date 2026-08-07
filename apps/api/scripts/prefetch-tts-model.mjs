// Downloads Kokoro's ONNX weights into the Hugging Face cache so a running
// container never has to.
//
// Without this, the ~90 MB quantized model is fetched from huggingface.co the
// first time speech is generated in each fresh container -- and because the
// pool starts three worker processes at once, all three cold-miss
// simultaneously and each pulls its own copy. That turns the first read-aloud
// after any deploy into a 10-60s wait, and makes a core feature depend on a
// third party being reachable at request time rather than at build time.
//
// Run during the Docker build (see apps/api/Dockerfile). The runtime stage
// copies the whole repo forward from the build stage, so populating the cache
// here is all it takes for it to be present at runtime -- no extra COPY.
//
// Deliberately exits 0 even on failure: a transient Hugging Face outage
// should degrade to the old behavior (fetch at runtime) rather than fail the
// image build outright.
import { KokoroTTS } from "kokoro-js";

// Must match tts-service.ts. If these drift, the build caches one model and
// the server downloads another -- silently, and only visible as the slow
// first request this script exists to prevent.
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const DTYPE = "q8";

try {
  const started = Date.now();
  await KokoroTTS.from_pretrained(MODEL_ID, { dtype: DTYPE });
  console.log(`[prefetch-tts-model] cached ${MODEL_ID} (${DTYPE}) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
} catch (err) {
  console.warn(
    `[prefetch-tts-model] WARNING: could not pre-cache the model; it will be fetched at runtime instead. ${
      err instanceof Error ? err.message : String(err)
    }`,
  );
}
