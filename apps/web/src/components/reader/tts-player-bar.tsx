"use client";

import { useTtsPlayer } from "@/lib/reader/tts-player-provider";
import { useDevicePrefs } from "@/lib/data/device-prefs-provider";
import { KOKORO_VOICES, NATIVE_VOICE_ID } from "@/lib/reader/kokoro-tts";
import { IconPause, IconPlay, IconStop, IconVolume, IconVolumeMute } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

const BUTTON_CLASS =
  "flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-muted";

/**
 * Global, Spotify/Readwise-style "now playing" bar -- mounted once in the
 * root layout (app/layout.tsx), visible on every page whenever the global
 * TtsPlayerProvider has something loaded, not just while looking at the
 * article being read. Lets play/pause/volume/voice all be controlled
 * without navigating back to the article or to Settings -- see
 * tts-player-provider.tsx for the state this reads and drives.
 */
export function TtsPlayerBar() {
  const player = useTtsPlayer();
  const { reader, setTtsVoice, setTtsVolume } = useDevicePrefs();

  if (!player.supported || player.status === "idle") return null;

  const isKokoro = player.totalChunks > 0;

  return (
    <div
      role="region"
      aria-label="Read-aloud player"
      className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-border bg-surface px-4 py-2.5 shadow-[0_-2px_12px_rgba(0,0,0,0.08)]"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {player.status === "loading" ? (
          <div className={cn(BUTTON_CLASS, "cursor-default")} title="Loading…">
            <svg viewBox="0 0 16 16" className="h-4 w-4 animate-spin" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
              <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        ) : player.status === "playing" ? (
          <button type="button" title="Pause" onClick={player.pause} className={BUTTON_CLASS}>
            <IconPause className="h-4 w-4" />
          </button>
        ) : (
          <button type="button" title="Resume" onClick={player.resume} className={BUTTON_CLASS}>
            <IconPlay className="h-4 w-4" />
          </button>
        )}
        <button type="button" title="Stop" onClick={player.stop} className={cn(BUTTON_CLASS, "h-7 w-7")}>
          <IconStop className="h-3.5 w-3.5" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="truncate font-sans text-sm font-medium text-ink">{player.articleTitle ?? "Reading aloud"}</div>
          <div className="truncate font-sans text-xs text-ink-faint">
            {player.status === "loading"
              ? "Loading…"
              : isKokoro
                ? `Sentence ${player.currentChunkIndex + 1} of ${player.totalChunks}`
                : "Reading…"}
          </div>
        </div>
      </div>

      <select
        aria-label="Read-aloud voice"
        value={reader.ttsVoice}
        onChange={(e) => setTtsVoice(e.target.value)}
        className="rounded-sm border border-border bg-paper px-2 py-1.5 font-sans text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <option value={NATIVE_VOICE_ID}>System voice</option>
        {KOKORO_VOICES.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          title={reader.ttsVolume === 0 ? "Unmute" : "Mute"}
          onClick={() => setTtsVolume(reader.ttsVolume === 0 ? 1 : 0)}
          className={cn(BUTTON_CLASS, "h-7 w-7 shrink-0")}
        >
          {reader.ttsVolume === 0 ? <IconVolumeMute className="h-4 w-4" /> : <IconVolume className="h-4 w-4" />}
        </button>
        <input
          type="range"
          aria-label="Volume"
          min={0}
          max={1}
          step={0.05}
          value={reader.ttsVolume}
          onChange={(e) => setTtsVolume(Number(e.target.value))}
          className="w-20 accent-accent"
        />
      </div>
    </div>
  );
}
