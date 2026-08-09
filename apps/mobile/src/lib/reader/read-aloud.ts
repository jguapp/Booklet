/**
 * Fetches one chunk of server-generated speech (POST /api/tts, raw WAV
 * bytes back) and turns it into something expo-av can play.
 *
 * The route is POST-only, so expo-av can't be pointed at it directly (its
 * uri source only ever GETs). The bytes are fetched here and staged
 * per-platform: a Blob object-URL on web, a file in the app's cache
 * directory on iOS/Android -- a data: URI would avoid the file write, but
 * iOS's AVPlayer doesn't reliably play data: URLs, and expo-file-system
 * doesn't exist on the web target, so each platform gets the mechanism
 * that's actually solid there. Every fetched chunk comes with its own
 * cleanup() and the player is responsible for calling it; leaking blob
 * URLs (web) is a memory leak, leaking files (native) is disk that never
 * comes back.
 *
 * Speed is applied server-side (the API's `speed` parameter), not via
 * expo-av's rate control -- the server's Kokoro pipeline changes speech
 * rate without the pitch shift a naive client-side rate change causes,
 * and it's also what the web player sends, so a cached chunk serves both.
 */
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import { API_URL } from "../config";
import { ApiError } from "../api";

export interface TtsChunkAudio {
  uri: string;
  cleanup: () => void;
}

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Hand-rolled rather than Buffer (Node-only) or btoa (not guaranteed on
// Hermes): ~50 lines of dependency-free certainty for the one place mobile
// needs binary-to-base64.
function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += BASE64_CHARS[b0 >> 2];
    out += BASE64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? BASE64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? BASE64_CHARS[b2 & 63] : "=";
  }
  return out;
}

let fileCounter = 0;

export async function fetchTtsChunkAudio(text: string, voice: string, speed: number): Promise<TtsChunkAudio> {
  const res = await fetch(`${API_URL}/api/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice, speed }),
  });
  if (!res.ok) {
    let message = "Speech generation failed.";
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // non-JSON error body -- keep the generic message
    }
    throw new ApiError(res.status, "tts_failed", message);
  }
  const buffer = await res.arrayBuffer();

  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
    return { uri: url, cleanup: () => URL.revokeObjectURL(url) };
  }

  const path = `${FileSystem.cacheDirectory}tts-${Date.now()}-${fileCounter++}.wav`;
  await FileSystem.writeAsStringAsync(path, toBase64(new Uint8Array(buffer)), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return {
    uri: path,
    cleanup: () => {
      void FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
    },
  };
}
