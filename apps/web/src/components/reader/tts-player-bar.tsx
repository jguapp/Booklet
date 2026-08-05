"use client";

import { useTtsPlayer } from "@/lib/reader/tts-player-provider";
import { useDevicePrefs } from "@/lib/data/device-prefs-provider";
import { KOKORO_VOICES, NATIVE_VOICE_ID } from "@/lib/reader/kokoro-tts";
import { IconPause, IconPlay, IconStop, IconVolume, IconVolumeMute } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

const SMALL_BUTTON_CLASS =
  "flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-muted";

// Bigger and filled, not just another icon-button in a row -- the
// play/pause transport control is the one action a "real playback player"
// (Spotify, Apple Music, Readwise's own bar) always gives center stage and
// visual weight over everything else in the bar, stop/volume/voice included.
const PLAY_BUTTON_CLASS =
  "flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-contrast transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100";

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

  // Word-level granularity within the current chunk, chunk-level across
  // the article -- smoother than jumping once per chunk (every few
  // seconds) the way a plain currentChunkIndex/totalChunks ratio would.
  // Only meaningful for Kokoro: native SpeechSynthesis reports no
  // boundaries at all (see tts-player-provider.tsx's playNative), so
  // there's nothing to compute a real fraction from -- rendered as an
  // indeterminate bar instead, same idea as a loading spinner with no
  // known duration.
  const chunkProgress =
    isKokoro && player.currentChunkText && player.currentWordRange
      ? Math.min(1, player.currentWordRange.start / Math.max(1, player.currentChunkText.length))
      : 0;
  const overallProgress = isKokoro && player.totalChunks > 0 ? Math.min(1, (player.currentChunkIndex + chunkProgress) / player.totalChunks) : 0;

  return (
    <div
      role="region"
      aria-label="Read-aloud player"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface px-4 py-2.5 shadow-[0_-2px_12px_rgba(0,0,0,0.08)]"
    >
      <div className="flex items-center gap-4">
        <div className="flex min-w-0 flex-1 items-center">
          <div className="min-w-0">
            <div className="truncate font-sans text-sm font-medium text-ink">{player.articleTitle ?? "Reading aloud"}</div>
            <div className="truncate font-sans text-xs text-ink-faint">
              {player.status === "loading" ? "Loading…" : player.status === "paused" ? "Paused" : "Playing"}
            </div>
          </div>
        </div>

        {/* Centered transport controls + progress bar -- balanced by the
            equal-flex left (title) and right (voice/volume) sections on
            either side, the same way a desktop Spotify-style bar keeps its
            controls dead-center regardless of how long the track title or
            the right-hand controls are. */}
        <div className="flex w-full max-w-sm flex-col items-center gap-1.5">
          <div className="flex items-center gap-3">
            <button type="button" title="Stop" onClick={player.stop} className={cn(SMALL_BUTTON_CLASS, "h-7 w-7")}>
              <IconStop className="h-3.5 w-3.5" />
            </button>

            {player.status === "loading" ? (
              <div className={cn(PLAY_BUTTON_CLASS, "cursor-default")} title="Loading…">
                <svg viewBox="0 0 16 16" className="h-4 w-4 animate-spin" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
                  <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
            ) : player.status === "playing" ? (
              <button type="button" title="Pause" onClick={player.pause} className={PLAY_BUTTON_CLASS}>
                <IconPause className="h-4 w-4" />
              </button>
            ) : (
              <button type="button" title="Resume" onClick={player.resume} className={PLAY_BUTTON_CLASS}>
                <IconPlay className="h-4 w-4 translate-x-[1px]" />
              </button>
            )}

            {/* Spacer matching the Stop button's footprint so the play/pause
                button lands visually centered between Stop and the empty
                space on its right, not off-center toward Stop. */}
            <div className="h-7 w-7" aria-hidden="true" />
          </div>

          <div
            className="h-1 w-full overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-label="Reading progress"
            aria-valuenow={isKokoro ? Math.round(overallProgress * 100) : undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            // Invisible to users (the visible surface is the filled bar
            // itself, per request -- no more "Sentence X of Y" text) --
            // exists so e2e coverage can still assert real chunk-count
            // behavior (see tts-player.spec.ts's regression guard against
            // the chunk-explosion bug) without needing visible text back.
            data-current-chunk={player.currentChunkIndex}
            data-total-chunks={player.totalChunks}
          >
            {isKokoro ? (
              <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-linear" style={{ width: `${overallProgress * 100}%` }} />
            ) : (
              <div className="tts-progress-indeterminate h-full w-1/3 rounded-full bg-accent" />
            )}
          </div>
        </div>

        <div className="flex flex-1 items-center justify-end gap-3">
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
              className={cn(SMALL_BUTTON_CLASS, "h-7 w-7 shrink-0")}
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
      </div>
    </div>
  );
}
