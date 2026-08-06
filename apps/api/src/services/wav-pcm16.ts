/**
 * Transcodes the 32-bit float WAV that kokoro-js hands back into an
 * equivalent 16-bit PCM WAV, halving every byte that flows from here on.
 *
 * Why this exists at all: `RawAudio.toWav()` (@huggingface/transformers'
 * encodeWAV) always emits IEEE-float samples -- format code 3, 32 bits, mono,
 * 24 kHz. That's 96,000 bytes per second of speech, so a first chunk of ~3.5
 * seconds is well over 300 KB, sitting directly on the time-to-first-audio
 * path. 16-bit PCM is 48,000 bytes/second for the same audio, and for speech
 * at this sample rate the difference is not perceptible -- 16-bit is what
 * essentially all recorded speech ships as.
 *
 * The saving compounds across four places, not one: the IPC structured clone
 * from the worker process back to the parent (see tts-pool.ts), the
 * in-memory cache, the Redis cache, and the actual HTTP response.
 *
 * Transcoding the encoded WAV rather than reading kokoro-js's internal
 * Float32Array is deliberate. It keeps this module a pure
 * Buffer-in/Buffer-out function with no dependency on kokoro-js or
 * onnxruntime at all, which means it's unit-testable without loading a
 * ~90 MB model -- the model load is what makes every other test in this area
 * slow enough to be skipped. The extra allocation is microseconds against
 * multi-second inference.
 */

const HEADER_BYTES = 44;
const FORMAT_IEEE_FLOAT = 3;
const FORMAT_PCM = 1;

export class WavTranscodeError extends Error {}

/**
 * @param input A 44-byte-header, mono, 32-bit float WAV (exactly what
 *   encodeWAV produces -- no extra/LIST chunks, which is why the fixed
 *   header offsets below are safe rather than needing a real chunk walker).
 * @returns The same audio as a 16-bit PCM WAV.
 */
export function toPcm16Wav(input: Buffer): Buffer {
  if (input.length < HEADER_BYTES) {
    throw new WavTranscodeError(`WAV too short to contain a header: ${input.length} bytes`);
  }

  // Buffers can be views into a shared pool, so the DataView has to be
  // anchored at the Buffer's own byteOffset rather than the start of the
  // underlying ArrayBuffer.
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);

  if (input.toString("ascii", 0, 4) !== "RIFF" || input.toString("ascii", 8, 12) !== "WAVE") {
    throw new WavTranscodeError("Not a RIFF/WAVE buffer");
  }

  const formatCode = view.getUint16(20, true);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);

  // Already 16-bit PCM: hand it back untouched rather than round-tripping
  // it, so this stays safe to call more than once on the same audio.
  if (formatCode === FORMAT_PCM && bitsPerSample === 16) return input;

  if (formatCode !== FORMAT_IEEE_FLOAT || bitsPerSample !== 32) {
    throw new WavTranscodeError(`Expected 32-bit IEEE float WAV, got format ${formatCode} / ${bitsPerSample}-bit`);
  }

  const dataBytes = view.getUint32(40, true);
  // Trust the buffer's real length over the declared data size -- a
  // truncated read would otherwise walk off the end below.
  const availableBytes = Math.min(dataBytes, input.byteLength - HEADER_BYTES);
  const sampleCount = Math.floor(availableBytes / 4);
  const outDataBytes = sampleCount * 2;

  const out = Buffer.allocUnsafe(HEADER_BYTES + outDataBytes);
  const outView = new DataView(out.buffer, out.byteOffset, out.byteLength);

  out.write("RIFF", 0, "ascii");
  outView.setUint32(4, 36 + outDataBytes, true);
  out.write("WAVE", 8, "ascii");
  out.write("fmt ", 12, "ascii");
  outView.setUint32(16, 16, true); // fmt chunk length
  outView.setUint16(20, FORMAT_PCM, true);
  outView.setUint16(22, channels, true);
  outView.setUint32(24, sampleRate, true);
  outView.setUint32(28, sampleRate * channels * 2, true); // byte rate
  outView.setUint16(32, channels * 2, true); // block align
  outView.setUint16(34, 16, true); // bits per sample
  out.write("data", 36, "ascii");
  outView.setUint32(40, outDataBytes, true);

  for (let i = 0; i < sampleCount; i++) {
    const sample = view.getFloat32(HEADER_BYTES + i * 4, true);
    // Clamp before scaling: Kokoro's output can overshoot [-1, 1] slightly,
    // and letting that wrap around int16 turns a loud syllable into a
    // burst of noise rather than mild clipping.
    const clamped = sample > 1 ? 1 : sample < -1 ? -1 : sample;
    // Asymmetric scale factors, matching how int16 audio is actually
    // defined: the negative range reaches -32768 but the positive range
    // stops at 32767.
    outView.setInt16(HEADER_BYTES + i * 2, Math.round(clamped < 0 ? clamped * 32768 : clamped * 32767), true);
  }

  return out;
}
