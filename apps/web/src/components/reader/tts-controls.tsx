"use client";

import type { TtsStatus } from "@/lib/reader/use-text-to-speech";
import { IconPause, IconPlay, IconStop } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

interface TtsControlsProps {
  status: TtsStatus;
  supported: boolean;
  hasText: boolean;
  onPlay: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

const BUTTON_CLASS =
  "flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-muted";

export function TtsControls({ status, supported, hasText, onPlay, onPause, onResume, onStop }: TtsControlsProps) {
  // Not every browser ships SpeechSynthesis (older/embedded webviews) --
  // rather than a dead button, just don't offer it there.
  if (!supported) return null;

  return (
    <div className="flex items-center gap-1">
      {status === "playing" ? (
        <button type="button" title="Pause reading aloud" onClick={onPause} className={BUTTON_CLASS}>
          <IconPause className="h-4 w-4" />
        </button>
      ) : (
        <button
          type="button"
          title={status === "paused" ? "Resume reading aloud" : "Read aloud"}
          onClick={status === "paused" ? onResume : onPlay}
          disabled={!hasText}
          className={BUTTON_CLASS}
        >
          <IconPlay className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        title="Stop reading aloud"
        onClick={onStop}
        disabled={status === "idle"}
        className={cn(BUTTON_CLASS, "h-6 w-6")}
      >
        <IconStop className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
