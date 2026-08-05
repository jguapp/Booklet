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
 * each voice has a `targetQuality`/`overallGrade`; extracted by hand from
 * node_modules/kokoro-js/dist/kokoro.cjs, since the library doesn't export
 * that data anywhere a consumer can just import). The previous version of
 * this list was every voice graded C or better -- 13 of them, six of which
 * were American-female voices sitting in the same B-/C+ quality band right
 * next to each other. Technically fine individually, but confirmed by hand
 * that a picker with that many similar-sounding options in one bucket reads
 * as "the same voice, over and over" rather than real variety. Cut down to
 * the strongest, most differentiated voice in each gender/accent x
 * character combination instead of every voice that merely clears a
 * quality bar -- fewer options, but each one earns its place. Character
 * descriptions (in the labels below) come from Kokoro's own community-
 * documented voice character notes, not something independently verified
 * by ear in this environment -- worth a real listening pass before taking
 * them as gospel if a voice ever sounds off from its label. */
export const KOKORO_VOICES: TtsVoiceOption[] = [
  { id: "af_heart", label: "Heart — warm & clear (US female)" },
  { id: "af_bella", label: "Bella — bright & confident (US female)" },
  { id: "am_fenrir", label: "Fenrir — deep & gravelly (US male)" },
  { id: "am_puck", label: "Puck — playful & energetic (US male)" },
  { id: "bf_emma", label: "Emma — crisp & proper (British female)" },
  { id: "bm_george", label: "George — deep & classic (British male)" },
  { id: "bm_fable", label: "Fable — warm & storytelling (British male)" },
];

export const KOKORO_VOICE_IDS = new Set(KOKORO_VOICES.map((v) => v.id));

/** The device's own SpeechSynthesis voice -- the default, since it needs no
 * network round-trip at all. Kept as a real option (not just "off") in the
 * same picker as the Kokoro voices. */
export const NATIVE_VOICE_ID = "system";

export function isKokoroVoice(voiceId: string): boolean {
  return voiceId !== NATIVE_VOICE_ID;
}
