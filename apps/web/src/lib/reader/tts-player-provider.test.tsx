import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDevicePrefs, DevicePrefsProvider } from "@/lib/data/device-prefs-provider";
import { ToastProvider } from "@/lib/toast/toast-provider";
import { cleanup, fire, render } from "@/test/render";
import { TtsPlayerProvider, useTtsPlayer } from "./tts-player-provider";

// The provider persists the listening position (#152) and reads
// isAuthenticated to decide local vs. synced -- which pulls in useAuth. These
// tests are about which engine pause/resume act on, not about auth, so the
// context is mocked rather than standing up a real AuthProvider (which would
// fetch a session in jsdom). Local mode is the honest default here.
vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => ({ status: "unauthenticated", isAuthenticated: false }),
}));

/**
 * Which engine pause/resume act on.
 *
 * Playback runs through one of two completely different engines -- the
 * device's own SpeechSynthesis, or generated Kokoro audio in an <audio>
 * element -- and the player bar exposes the voice dropdown right next to the
 * pause button, so the preference can change while a voice is mid-sentence.
 * Dispatching on the preference instead of on what is actually playing is
 * silent in every other respect: the bar changes to "Paused" either way, and
 * only the sound coming out of the speakers says otherwise. That makes it
 * exactly the kind of thing worth pinning here rather than in Playwright,
 * where "is audio still playing" is barely observable.
 */

const speechSynthesis = {
  pause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  speak: vi.fn(),
  getVoices: () => [],
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

interface Handle {
  play: () => void;
  pause: () => void;
  resume: () => void;
  setVoice: (voice: string) => void;
  status: string;
}

let handle: Handle;

function Probe() {
  const player = useTtsPlayer();
  const { setTtsVoice } = useDevicePrefs();
  // In an effect, not during render: assigning to a module variable while
  // rendering is a side effect, and the lint rules here (correctly) reject
  // it. Every assertion below runs after an act() flush, so the effect has
  // always run by the time `handle` is read.
  useEffect(() => {
    handle = {
      play: () => player.play("a1", "An article", "Some text to read aloud."),
      pause: player.pause,
      resume: player.resume,
      setVoice: setTtsVoice,
      status: player.status,
    };
  });
  return null;
}

function mount() {
  render(
    <ToastProvider>
      <DevicePrefsProvider>
        <TtsPlayerProvider>
          <Probe />
        </TtsPlayerProvider>
      </DevicePrefsProvider>
    </ToastProvider>,
  );
}

describe("TtsPlayerProvider pause/resume", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    // jsdom ships no SpeechSynthesis at all; the provider feature-detects it.
    Object.defineProperty(window, "speechSynthesis", { value: speechSynthesis, configurable: true });
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: class {
        constructor(public text: string) {}
      },
      configurable: true,
    });
  });

  afterEach(cleanup);

  it("pauses the engine that is actually playing, not the currently-selected voice", () => {
    mount();
    // Default voice is the device's own SpeechSynthesis.
    fire(() => handle.play());
    expect(speechSynthesis.speak).toHaveBeenCalledTimes(1);

    // Changing the voice mid-playback does not switch engines -- the current
    // utterance keeps speaking through SpeechSynthesis.
    fire(() => handle.setVoice("af_heart"));
    fire(() => handle.pause());

    expect(speechSynthesis.pause).toHaveBeenCalledTimes(1);
    expect(handle.status).toBe("paused");

    fire(() => handle.resume());
    expect(speechSynthesis.resume).toHaveBeenCalledTimes(1);
    expect(handle.status).toBe("playing");
  });

  it("ignores pause/resume when nothing is loaded", () => {
    mount();
    fire(() => handle.pause());
    fire(() => handle.resume());
    expect(speechSynthesis.pause).not.toHaveBeenCalled();
    expect(speechSynthesis.resume).not.toHaveBeenCalled();
    expect(handle.status).toBe("idle");
  });
});
