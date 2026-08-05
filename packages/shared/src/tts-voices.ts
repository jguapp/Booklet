/**
 * Shared between apps/api (which actually generates speech, server-side --
 * see apps/api/src/services/tts-service.ts) and apps/web (which offers the
 * picker and sends the id through, see apps/web/src/lib/reader/tts-client.ts)
 * so both sides validate/label the same finite set of real voices instead
 * of one silently drifting from the other.
 */
export interface TtsVoiceOption {
  id: string;
  label: string;
}

/** Kokoro ships 28 voices (see kokoro-js's own bundled quality metadata --
 * each voice has a `targetQuality`/`overallGrade`). This is every voice
 * graded C or better, spanning both genders and American/British English
 * -- the D-and-below voices are real but audibly rougher, so they're left
 * out rather than padding the picker with options that sound worse than
 * the system voice. */
export const KOKORO_VOICES: TtsVoiceOption[] = [
  { id: "af_heart", label: "Heart (American, female)" },
  { id: "af_bella", label: "Bella (American, female)" },
  { id: "af_nicole", label: "Nicole (American, female)" },
  { id: "af_aoede", label: "Aoede (American, female)" },
  { id: "af_kore", label: "Kore (American, female)" },
  { id: "af_sarah", label: "Sarah (American, female)" },
  { id: "am_michael", label: "Michael (American, male)" },
  { id: "am_fenrir", label: "Fenrir (American, male)" },
  { id: "am_puck", label: "Puck (American, male)" },
  { id: "bf_emma", label: "Emma (British, female)" },
  { id: "bf_isabella", label: "Isabella (British, female)" },
  { id: "bm_george", label: "George (British, male)" },
  { id: "bm_fable", label: "Fable (British, male)" },
];

export const KOKORO_VOICE_IDS = new Set(KOKORO_VOICES.map((v) => v.id));

/** The device's own SpeechSynthesis voice -- the default, since it needs no
 * network round-trip at all. Kept as a real option (not just "off") in the
 * same picker as the Kokoro voices. */
export const NATIVE_VOICE_ID = "system";

export function isKokoroVoice(voiceId: string): boolean {
  return voiceId !== NATIVE_VOICE_ID;
}
