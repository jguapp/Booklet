/**
 * Picks the most natural-sounding available voice. An utterance with no
 * `.voice` set falls back to the platform default, which on most desktop
 * OSes is a legacy low-quality voice (Windows SAPI's "Microsoft David/Zira
 * Desktop") -- the classic robotic/uncanny TTS people complain about.
 * Newer neural voices (Windows/Edge's "...Online (Natural)", Chrome's
 * cloud-backed "Google" voices) sound far more human when available.
 * Scored rather than hard-coded by name, since exact availability varies
 * by browser/OS/locale.
 */
function score(voice: SpeechSynthesisVoice, lang: string): number {
  const voiceLang = voice.lang.toLowerCase();
  let s = 0;
  if (voiceLang === lang) s += 100;
  else if (voiceLang.startsWith(lang.split("-")[0])) s += 50;
  if (/natural/i.test(voice.name)) s += 40; // Windows/Edge neural voices
  if (/online/i.test(voice.name)) s += 15; // cloud-backed, usually higher quality than a bundled local voice
  if (/google/i.test(voice.name)) s += 20; // Chrome's cloud voices
  if (!voice.localService) s += 15;
  if (voice.default) s += 5;
  return s;
}

export function pickBestVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const normalizedLang = lang.toLowerCase();
  return [...voices].sort((a, b) => score(b, normalizedLang) - score(a, normalizedLang))[0];
}
