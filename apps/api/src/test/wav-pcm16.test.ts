import { describe, expect, it } from "vitest";
import { toPcm16Wav, WavTranscodeError } from "../services/wav-pcm16.js";

/**
 * These run without loading Kokoro at all -- the whole reason toPcm16Wav
 * transcodes an encoded WAV rather than reaching into kokoro-js's internal
 * Float32Array. Model-loading tests are slow enough that they get skipped;
 * this is the conversion that every byte of generated audio passes through,
 * so it needs coverage that actually runs.
 */

/** Builds the exact shape @huggingface/transformers' encodeWAV emits: a flat
 * 44-byte header, mono, 32-bit IEEE float. */
function float32Wav(samples: number[], sampleRate = 24000): Buffer {
  const buf = Buffer.alloc(44 + samples.length * 4);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  buf.write("RIFF", 0, "ascii");
  view.setUint32(4, 36 + samples.length * 4, true);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); // IEEE float
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 32, true);
  buf.write("data", 36, "ascii");
  view.setUint32(40, samples.length * 4, true);
  samples.forEach((s, i) => view.setFloat32(44 + i * 4, s, true));
  return buf;
}

function header(buf: Buffer) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    riff: buf.toString("ascii", 0, 4),
    wave: buf.toString("ascii", 8, 12),
    riffSize: view.getUint32(4, true),
    formatCode: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    data: buf.toString("ascii", 36, 40),
    dataSize: view.getUint32(40, true),
  };
}

function samplesOf(buf: Buffer): number[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = view.getUint32(40, true) / 2;
  return Array.from({ length: count }, (_, i) => view.getInt16(44 + i * 2, true));
}

describe("toPcm16Wav", () => {
  it("writes a valid 16-bit PCM header preserving rate and channels", () => {
    const out = toPcm16Wav(float32Wav([0, 0.5, -0.5, 1], 24000));
    expect(header(out)).toEqual({
      riff: "RIFF",
      wave: "WAVE",
      riffSize: 36 + 8,
      formatCode: 1,
      channels: 1,
      sampleRate: 24000,
      byteRate: 24000 * 2,
      blockAlign: 2,
      bitsPerSample: 16,
      data: "data",
      dataSize: 8,
    });
  });

  it("halves the payload", () => {
    const input = float32Wav(new Array(1000).fill(0.25));
    const out = toPcm16Wav(input);
    expect(input.length).toBe(44 + 4000);
    expect(out.length).toBe(44 + 2000);
  });

  it("converts sample values using the asymmetric int16 range", () => {
    const out = toPcm16Wav(float32Wav([0, 1, -1, 0.5, -0.5]));
    expect(samplesOf(out)).toEqual([0, 32767, -32768, Math.round(0.5 * 32767), Math.round(-0.5 * 32768)]);
  });

  it("clamps overshoot instead of letting it wrap around", () => {
    // Kokoro's output can exceed [-1, 1] slightly; wrapping would turn a
    // loud syllable into a burst of noise rather than mild clipping.
    const out = toPcm16Wav(float32Wav([1.4, -1.4]));
    expect(samplesOf(out)).toEqual([32767, -32768]);
  });

  it("is idempotent -- already-16-bit input is returned untouched", () => {
    const once = toPcm16Wav(float32Wav([0.1, -0.2, 0.3]));
    expect(toPcm16Wav(once)).toBe(once);
  });

  it("tolerates a declared data size longer than the actual buffer", () => {
    const input = float32Wav([0.5, 0.5]);
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    view.setUint32(40, 4096, true); // lie about the data length
    const out = toPcm16Wav(input);
    expect(samplesOf(out)).toHaveLength(2);
  });

  it("rejects buffers that aren't RIFF/WAVE", () => {
    const notWav = Buffer.alloc(64);
    expect(() => toPcm16Wav(notWav)).toThrow(WavTranscodeError);
  });

  it("rejects a WAV that is neither 32-bit float nor 16-bit PCM", () => {
    const input = float32Wav([0.5]);
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    view.setUint16(34, 24, true); // 24-bit
    expect(() => toPcm16Wav(input)).toThrow(WavTranscodeError);
  });

  it("rejects a truncated header", () => {
    expect(() => toPcm16Wav(Buffer.alloc(10))).toThrow(WavTranscodeError);
  });
});
