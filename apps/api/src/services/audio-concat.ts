/**
 * Joins the per-chunk WAVs the TTS pool produces into the one file a podcast
 * client wants behind a single <enclosure> (#154).
 *
 * A podcast client has no notion of "chunk" -- it downloads one URL per
 * episode and plays it. TTS generates ~140 characters at a time (see
 * @booklet/shared's tts-chunking.ts), so a 2,000-word article arrives as a
 * few hundred separate WAV files that have to become one before the feed can
 * point at them.
 *
 * Concatenation rather than re-encoding is possible only because every input
 * is already identical in format: wav-pcm16.ts converts everything the model
 * emits to mono 16-bit PCM at Kokoro's 24 kHz, with the same flat 44-byte
 * header, before it leaves the worker process. That makes the join a memcpy
 * of the sample data plus two rewritten length fields -- no resampling, no
 * requantizing, no dependency on ffmpeg or any native codec. The invariant is
 * load-bearing, so readWavInfo below verifies it per input instead of
 * assuming it: two chunks at different sample rates spliced together play the
 * second one at the wrong pitch, silently, with no error anywhere.
 *
 * The 44-byte fixed offsets are safe for the same reason they are safe in
 * wav-pcm16.ts: every buffer reaching here was written by that module, which
 * emits a canonical RIFF/fmt/data header with no LIST or extension chunks. A
 * general-purpose WAV reader would need a real chunk walker; this is not one,
 * and readWavInfo rejects anything that does not match the shape it expects
 * rather than misreading it.
 */

const HEADER_BYTES = 44;
const FORMAT_PCM = 1;
const BITS_PER_SAMPLE = 16;

/** RIFF's size fields are unsigned 32-bit, so a file whose header would need
 * more than this cannot be described by the format at all -- the field wraps
 * and every player reads a wildly wrong length. Far beyond any real article
 * (~24 hours of 24 kHz mono), but a wrapped length is the kind of corruption
 * that shows up as "the episode is nine seconds long" rather than as an
 * error, so it gets an explicit failure. */
const MAX_RIFF_PAYLOAD_BYTES = 0xffff_ffff - 36;

export class WavConcatError extends Error {}

export interface Pcm16WavInfo {
  sampleRate: number;
  channels: number;
  /** Bytes per sample frame -- the unit sample data must stay aligned to. */
  blockAlign: number;
  byteRate: number;
  /** Usable sample bytes: the smaller of the declared data-chunk size and
   * what the buffer actually holds, floored to a whole number of frames. */
  dataBytes: number;
}

/**
 * Validates one chunk and reports the numbers concatenation needs.
 *
 * `dataBytes` is deliberately not just the declared data-chunk size. Two
 * things can make that number a lie, and both are worse here than they are
 * for a single chunk played on its own:
 *
 * - A truncated buffer (a partial IPC message, a short read) declares more
 *   data than it carries, and copying that many bytes reads past the end of
 *   the chunk into whatever follows it.
 * - A byte count that is not a whole number of frames -- an odd length for
 *   mono 16-bit -- offsets *every subsequent chunk* by one byte. In 16-bit
 *   PCM that swaps the high and low byte of every sample from that point on,
 *   so the remainder of the article plays as full-scale noise rather than as
 *   speech. A single chunk with a stray trailing byte is inaudible; the same
 *   byte inside a concatenation destroys everything after it.
 */
export function readWavInfo(buffer: Buffer): Pcm16WavInfo {
  if (buffer.length < HEADER_BYTES) {
    throw new WavConcatError(`WAV too short to contain a header: ${buffer.length} bytes`);
  }
  // Buffers can be views into a shared pool, so the DataView has to be
  // anchored at the Buffer's own byteOffset (same reasoning as wav-pcm16.ts).
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new WavConcatError("Not a RIFF/WAVE buffer");
  }

  const formatCode = view.getUint16(20, true);
  const bitsPerSample = view.getUint16(34, true);
  if (formatCode !== FORMAT_PCM || bitsPerSample !== BITS_PER_SAMPLE) {
    throw new WavConcatError(`Expected 16-bit PCM, got format ${formatCode} / ${bitsPerSample}-bit`);
  }

  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  if (channels < 1 || sampleRate < 1) {
    throw new WavConcatError(`Nonsensical WAV format: ${channels} channels at ${sampleRate} Hz`);
  }

  // Derived, not read from offsets 28/32: those fields are redundant with
  // channels/sampleRate/bitsPerSample, and if a writer ever disagrees with
  // itself the derived value is the one the sample data actually follows.
  const blockAlign = channels * (BITS_PER_SAMPLE / 8);
  const byteRate = sampleRate * blockAlign;

  const declared = view.getUint32(40, true);
  const available = Math.min(declared, buffer.byteLength - HEADER_BYTES);
  const dataBytes = available - (available % blockAlign);

  return { sampleRate, channels, blockAlign, byteRate, dataBytes };
}

/**
 * Splices any number of identically-formatted 16-bit PCM WAVs into one.
 *
 * Empty input throws rather than returning a zero-sample WAV: with no chunks
 * there is no sample rate or channel count to put in the header, so the only
 * thing that could be returned is a header full of guesses. An episode with
 * no audio is a real condition (an article whose extracted text is empty),
 * and the caller has to notice it and skip the article -- publishing a
 * plausible-looking silent enclosure would make that indistinguishable from
 * a working episode that happens to be quiet.
 *
 * A single input is put through the same path rather than returned untouched,
 * so the result's declared lengths always describe the bytes that are
 * actually there. Returning the input verbatim would pass a chunk with a
 * wrong or truncated data-size field straight through to a podcast client,
 * which is exactly the case readWavInfo exists to normalize.
 */
export function concatPcm16Wavs(parts: readonly Buffer[]): Buffer {
  if (parts.length === 0) {
    throw new WavConcatError("Cannot concatenate zero WAV chunks -- there is no format to build a header from.");
  }

  const infos = parts.map(readWavInfo);
  const { sampleRate, channels, blockAlign, byteRate } = infos[0];
  for (const [index, info] of infos.entries()) {
    if (info.sampleRate !== sampleRate || info.channels !== channels) {
      throw new WavConcatError(
        `Chunk ${index} is ${info.channels}ch @ ${info.sampleRate}Hz, expected ${channels}ch @ ${sampleRate}Hz`,
      );
    }
  }

  const dataBytes = infos.reduce((sum, info) => sum + info.dataBytes, 0);
  if (dataBytes > MAX_RIFF_PAYLOAD_BYTES) {
    throw new WavConcatError(`Concatenated audio is too large for a RIFF container: ${dataBytes} bytes`);
  }

  const out = Buffer.allocUnsafe(HEADER_BYTES + dataBytes);
  const outView = new DataView(out.buffer, out.byteOffset, out.byteLength);

  out.write("RIFF", 0, "ascii");
  // 36 = everything after this field except the sample data (4 "WAVE" + 8+16
  // fmt chunk + 8 data chunk header).
  outView.setUint32(4, 36 + dataBytes, true);
  out.write("WAVE", 8, "ascii");
  out.write("fmt ", 12, "ascii");
  outView.setUint32(16, 16, true); // fmt chunk length
  outView.setUint16(20, FORMAT_PCM, true);
  outView.setUint16(22, channels, true);
  outView.setUint32(24, sampleRate, true);
  outView.setUint32(28, byteRate, true);
  outView.setUint16(32, blockAlign, true);
  outView.setUint16(34, BITS_PER_SAMPLE, true);
  out.write("data", 36, "ascii");
  outView.setUint32(40, dataBytes, true);

  let offset = HEADER_BYTES;
  for (const [index, part] of parts.entries()) {
    // Copies exactly readWavInfo's usable length, not the rest of the
    // buffer -- see its comment for why an over-declared or frame-misaligned
    // chunk has to be trimmed here rather than trusted.
    part.copy(out, offset, HEADER_BYTES, HEADER_BYTES + infos[index].dataBytes);
    offset += infos[index].dataBytes;
  }

  return out;
}

/**
 * Playback length in whole seconds, for <itunes:duration>.
 *
 * Derived from the byte count rather than tracked alongside generation
 * because it has to describe the file that actually shipped: readWavInfo
 * may have trimmed a chunk, so a duration accumulated from what was
 * requested would drift from what a listener hears.
 */
export function pcm16WavDurationSeconds(buffer: Buffer): number {
  const { dataBytes, byteRate } = readWavInfo(buffer);
  return Math.round(dataBytes / byteRate);
}
