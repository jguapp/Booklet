import { describe, expect, it } from "vitest";
import { concatPcm16Wavs, pcm16WavDurationSeconds, readWavInfo, WavConcatError } from "../services/audio-concat.js";

/**
 * Runs without Kokoro, on synthetic PCM built here -- which is a complete
 * test of what this module actually does. The splice and the header rewrite
 * are pure arithmetic over bytes; real speech would only make the samples
 * harder to assert on and add a ~90 MB model load to the suite.
 */

const SAMPLE_RATE = 24000;

/** The exact shape wav-pcm16.ts emits: flat 44-byte header, mono, 16-bit PCM.
 * `declaredDataBytes` is separable from the real payload so the truncation
 * and misalignment cases can build a header that lies. */
function pcm16Wav(
  samples: number[],
  { sampleRate = SAMPLE_RATE, channels = 1, declaredDataBytes, trailingBytes = 0 } = {} as {
    sampleRate?: number;
    channels?: number;
    declaredDataBytes?: number;
    trailingBytes?: number;
  },
): Buffer {
  const dataBytes = samples.length * 2 + trailingBytes;
  const buf = Buffer.alloc(44 + dataBytes);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  buf.write("RIFF", 0, "ascii");
  view.setUint32(4, 36 + dataBytes, true);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  buf.write("data", 36, "ascii");
  view.setUint32(40, declaredDataBytes ?? dataBytes, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, s, true));
  return buf;
}

function samplesOf(buf: Buffer): number[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = (buf.length - 44) / 2;
  return Array.from({ length: count }, (_, i) => view.getInt16(44 + i * 2, true));
}

function header(buf: Buffer) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    riff: buf.toString("ascii", 0, 4),
    riffSize: view.getUint32(4, true),
    wave: buf.toString("ascii", 8, 12),
    fmt: buf.toString("ascii", 12, 16),
    formatCode: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    dataTag: buf.toString("ascii", 36, 40),
    dataSize: view.getUint32(40, true),
  };
}

describe("concatPcm16Wavs", () => {
  it("splices sample data in order and rewrites both length fields", () => {
    const out = concatPcm16Wavs([pcm16Wav([1, 2, 3]), pcm16Wav([4, 5]), pcm16Wav([6])]);

    expect(samplesOf(out)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(out.length).toBe(44 + 12);
    expect(header(out)).toMatchObject({
      riff: "RIFF",
      wave: "WAVE",
      fmt: "fmt ",
      dataTag: "data",
      formatCode: 1,
      channels: 1,
      bitsPerSample: 16,
      sampleRate: SAMPLE_RATE,
      byteRate: SAMPLE_RATE * 2,
      blockAlign: 2,
      // 36 covers everything after the RIFF size field except the samples.
      riffSize: 36 + 12,
      dataSize: 12,
    });
  });

  it("throws on an empty list rather than inventing a header", () => {
    expect(() => concatPcm16Wavs([])).toThrow(WavConcatError);
  });

  it("normalizes a single chunk instead of passing its header through", () => {
    // A lone chunk whose declared data size is larger than what it carries --
    // returning the input untouched would hand that lie to a podcast client.
    const lying = pcm16Wav([7, 8], { declaredDataBytes: 4096 });
    const out = concatPcm16Wavs([lying]);

    expect(samplesOf(out)).toEqual([7, 8]);
    expect(header(out).dataSize).toBe(4);
    expect(header(out).riffSize).toBe(40);
  });

  it("keeps a chunk that declares more data than it holds from reading past its end", () => {
    const truncated = pcm16Wav([9, 10], { declaredDataBytes: 1000 });
    const out = concatPcm16Wavs([truncated, pcm16Wav([11])]);

    expect(samplesOf(out)).toEqual([9, 10, 11]);
    expect(header(out).dataSize).toBe(6);
  });

  it("drops a trailing odd byte rather than shifting every later chunk by one", () => {
    // A frame-misaligned chunk is the nastiest case: one stray byte swaps the
    // high and low half of every sample after it, so the rest of the article
    // plays as noise instead of speech.
    const odd = pcm16Wav([1, 2], { trailingBytes: 1 });
    const out = concatPcm16Wavs([odd, pcm16Wav([3, 4])]);

    expect(samplesOf(out)).toEqual([1, 2, 3, 4]);
    expect(header(out).dataSize).toBe(8);
  });

  it("accepts a chunk with no samples at all", () => {
    const out = concatPcm16Wavs([pcm16Wav([1]), pcm16Wav([]), pcm16Wav([2])]);
    expect(samplesOf(out)).toEqual([1, 2]);
  });

  it("refuses to splice mismatched formats", () => {
    expect(() => concatPcm16Wavs([pcm16Wav([1]), pcm16Wav([2], { sampleRate: 16000 })])).toThrow(
      /16000Hz|24000Hz/,
    );
    expect(() => concatPcm16Wavs([pcm16Wav([1]), pcm16Wav([2, 3], { channels: 2 })])).toThrow(WavConcatError);
  });

  it("rejects anything that is not a 16-bit PCM RIFF/WAVE buffer", () => {
    expect(() => concatPcm16Wavs([Buffer.alloc(10)])).toThrow(/too short/);
    expect(() => concatPcm16Wavs([Buffer.alloc(64)])).toThrow(/RIFF/);

    const float = pcm16Wav([1, 2]);
    new DataView(float.buffer, float.byteOffset, float.byteLength).setUint16(20, 3, true); // IEEE float
    expect(() => concatPcm16Wavs([float])).toThrow(/Expected 16-bit PCM/);

    const zeroRate = pcm16Wav([1, 2], { sampleRate: 0 });
    expect(() => concatPcm16Wavs([zeroRate])).toThrow(/Nonsensical/);
  });

  it("survives the chunk counts a real article produces", () => {
    // 250 chunks is MAX_EPISODE_CHUNKS in routes/podcast.ts -- the point is
    // that the offsets stay right across many splices, not just three.
    const parts = Array.from({ length: 250 }, (_, i) => pcm16Wav([i, -i]));
    const out = concatPcm16Wavs(parts);

    expect(out.length).toBe(44 + 250 * 4);
    expect(header(out).dataSize).toBe(1000);
    expect(samplesOf(out).slice(-2)).toEqual([249, -249]);
  });
});

describe("pcm16WavDurationSeconds", () => {
  it("derives whole seconds from the byte count", () => {
    const oneSecond = pcm16Wav(new Array(SAMPLE_RATE).fill(0));
    expect(pcm16WavDurationSeconds(oneSecond)).toBe(1);

    const twoAndAHalf = pcm16Wav(new Array(SAMPLE_RATE * 2.5).fill(0));
    expect(pcm16WavDurationSeconds(twoAndAHalf)).toBe(3);
  });

  it("measures the bytes that survived readWavInfo, not the declared ones", () => {
    const lying = pcm16Wav(new Array(SAMPLE_RATE).fill(0), { declaredDataBytes: SAMPLE_RATE * 200 });
    expect(pcm16WavDurationSeconds(lying)).toBe(1);
  });
});

describe("readWavInfo", () => {
  it("derives byteRate and blockAlign rather than trusting the header's copies", () => {
    const buf = pcm16Wav([1, 2, 3]);
    // Both fields are redundant with channels/sampleRate/bits; a writer that
    // disagreed with itself would otherwise corrupt the joined header.
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    view.setUint32(28, 999, true);
    view.setUint16(32, 7, true);

    expect(readWavInfo(buf)).toEqual({
      sampleRate: SAMPLE_RATE,
      channels: 1,
      blockAlign: 2,
      byteRate: SAMPLE_RATE * 2,
      dataBytes: 6,
    });
  });
});
