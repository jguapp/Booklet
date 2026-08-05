"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReaderSize } from "@/components/reader/reader-toolbar";
import { DEFAULT_HIGHLIGHT_BAR_COLORS } from "@booklet/shared";
import { loadReaderPrefs, saveReaderPrefs, type ReaderPrefs } from "@/lib/reader/device-prefs";
import { NATIVE_VOICE_ID } from "@/lib/reader/kokoro-tts";
import { loadHoardingPrefs, saveHoardingPrefs, type HoardingPrefs } from "./hoarding-prefs";
import { loadShowReadingStats, saveShowReadingStats } from "./stats-prefs";
import { loadAutoDeletePrefs, saveAutoDeletePrefs, type AutoDeletePrefs } from "./auto-delete-prefs";
import { loadNavOrder, saveNavOrder } from "./nav-order-prefs";
import { loadSidebarCompact, saveSidebarCompact } from "./sidebar-prefs";

/**
 * Every device-local (not account-synced) preference in one place, reactive
 * everywhere it's read. Each individual pref still has its own small
 * load/save module (device-prefs.ts, hoarding-prefs.ts, etc.) -- this
 * doesn't change the storage format, just fixes a real bug: Settings and
 * its consumers (the app shell's nav, reader-view.tsx, use-text-to-
 * speech.ts, library/page.tsx) previously each read localStorage
 * independently on their own mount, so a change made on the Settings page
 * didn't apply anywhere else until a full reload remounted everything.
 * Routing every read and write through one shared context (same pattern as
 * ThemeProvider, which never had this problem) means a `setXxx` call here
 * re-renders every consumer immediately.
 */
interface DevicePrefsState {
  reader: ReaderPrefs;
  hoarding: HoardingPrefs;
  showReadingStats: boolean;
  autoDelete: AutoDeletePrefs;
  navOrder: string[];
  sidebarCompact: boolean;
}

interface DevicePrefsContextValue extends DevicePrefsState {
  setReaderSize: (size: ReaderSize) => void;
  setTtsRate: (rate: number) => void;
  setTtsVoice: (voice: string) => void;
  setTtsVolume: (volume: number) => void;
  setHighlightBarColors: (colors: string[]) => void;
  setShowProgressBar: (enabled: boolean) => void;
  setPdfReadingMode: (mode: "paginate" | "scroll") => void;
  setHoarding: (prefs: HoardingPrefs) => void;
  setShowReadingStats: (enabled: boolean) => void;
  setAutoDelete: (prefs: AutoDeletePrefs) => void;
  setNavOrder: (order: string[]) => void;
  setSidebarCompact: (compact: boolean) => void;
}

const DevicePrefsContext = createContext<DevicePrefsContextValue | null>(null);

// The server has no localStorage at all, so it always renders these --
// same reasoning as ThemeProvider's own default-then-correct-after-mount
// split (see the effect below). No hydration mismatch: nothing here
// renders differently server- vs client-side on first paint, only after.
const SERVER_DEFAULTS: DevicePrefsState = {
  reader: {
    size: "md",
    ttsRate: 1,
    ttsVoice: NATIVE_VOICE_ID,
    ttsVolume: 1,
    highlightBarColors: DEFAULT_HIGHLIGHT_BAR_COLORS,
    showProgressBar: true,
    pdfReadingMode: "paginate",
  },
  hoarding: { enabled: false, maxUnread: 25 },
  showReadingStats: false,
  autoDelete: { enabled: false, days: 90 },
  navOrder: [],
  sidebarCompact: false,
};

export function DevicePrefsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DevicePrefsState>(SERVER_DEFAULTS);

  useEffect(() => {
    function syncFromStorage() {
      setState({
        reader: loadReaderPrefs(),
        hoarding: loadHoardingPrefs(),
        showReadingStats: loadShowReadingStats(),
        autoDelete: loadAutoDeletePrefs(),
        navOrder: loadNavOrder(),
        sidebarCompact: loadSidebarCompact(),
      });
    }
    syncFromStorage();
  }, []);

  const setReaderSize = useCallback((size: ReaderSize) => {
    setState((prev) => {
      const next = { ...prev.reader, size };
      saveReaderPrefs(next);
      return { ...prev, reader: next };
    });
  }, []);

  const setTtsRate = useCallback((rate: number) => {
    setState((prev) => {
      const next = { ...prev.reader, ttsRate: rate };
      saveReaderPrefs(next);
      return { ...prev, reader: next };
    });
  }, []);

  const setTtsVoice = useCallback((voice: string) => {
    setState((prev) => {
      const next = { ...prev.reader, ttsVoice: voice };
      saveReaderPrefs(next);
      return { ...prev, reader: next };
    });
  }, []);

  const setTtsVolume = useCallback((volume: number) => {
    setState((prev) => {
      const next = { ...prev.reader, ttsVolume: volume };
      saveReaderPrefs(next);
      return { ...prev, reader: next };
    });
  }, []);

  const setHighlightBarColors = useCallback((colors: string[]) => {
    setState((prev) => {
      const next = { ...prev.reader, highlightBarColors: colors };
      saveReaderPrefs(next);
      return { ...prev, reader: next };
    });
  }, []);

  const setShowProgressBar = useCallback((enabled: boolean) => {
    setState((prev) => {
      const next = { ...prev.reader, showProgressBar: enabled };
      saveReaderPrefs(next);
      return { ...prev, reader: next };
    });
  }, []);

  const setPdfReadingMode = useCallback((mode: "paginate" | "scroll") => {
    setState((prev) => {
      const next = { ...prev.reader, pdfReadingMode: mode };
      saveReaderPrefs(next);
      return { ...prev, reader: next };
    });
  }, []);

  const setHoarding = useCallback((prefs: HoardingPrefs) => {
    saveHoardingPrefs(prefs);
    setState((prev) => ({ ...prev, hoarding: prefs }));
  }, []);

  const setShowReadingStats = useCallback((enabled: boolean) => {
    saveShowReadingStats(enabled);
    setState((prev) => ({ ...prev, showReadingStats: enabled }));
  }, []);

  const setAutoDelete = useCallback((prefs: AutoDeletePrefs) => {
    saveAutoDeletePrefs(prefs);
    setState((prev) => ({ ...prev, autoDelete: prefs }));
  }, []);

  const setNavOrder = useCallback((order: string[]) => {
    saveNavOrder(order);
    setState((prev) => ({ ...prev, navOrder: order }));
  }, []);

  const setSidebarCompact = useCallback((compact: boolean) => {
    saveSidebarCompact(compact);
    setState((prev) => ({ ...prev, sidebarCompact: compact }));
  }, []);

  return (
    <DevicePrefsContext.Provider
      value={{
        ...state,
        setReaderSize,
        setTtsRate,
        setTtsVoice,
        setTtsVolume,
        setHighlightBarColors,
        setShowProgressBar,
        setPdfReadingMode,
        setHoarding,
        setShowReadingStats,
        setAutoDelete,
        setNavOrder,
        setSidebarCompact,
      }}
    >
      {children}
    </DevicePrefsContext.Provider>
  );
}

export function useDevicePrefs(): DevicePrefsContextValue {
  const ctx = useContext(DevicePrefsContext);
  if (!ctx) throw new Error("useDevicePrefs must be used within a DevicePrefsProvider");
  return ctx;
}
