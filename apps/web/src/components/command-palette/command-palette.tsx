"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { Collection } from "@booklet/shared";
import type { IconProps } from "@/components/ui/icons";
import { IconFolder, IconSearch } from "@/components/ui/icons";
import { useTheme, type Theme } from "@/lib/theme/theme-provider";
import { useDevicePrefs } from "@/lib/data/device-prefs-provider";
import { useAuth } from "@/lib/auth/auth-provider";
import { searchLibrary } from "@/lib/data/search";
import { fuzzyScore } from "@/lib/command-palette/fuzzy-match";
import { cn } from "@/lib/cn";

interface NavItem {
  href: string;
  label: string;
  Icon: (props: IconProps) => React.ReactElement;
}

interface CommandPaletteProps {
  navItems: NavItem[];
  collections: Collection[];
  onClose: () => void;
}

type Entry = {
  id: string;
  group: "Navigate" | "Actions" | "Search";
  label: string;
  sublabel?: string;
  Icon: (props: IconProps) => React.ReactElement;
  run: () => void;
  score: number;
};

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "sepia", label: "Sepia" },
  { value: "dark", label: "Dark" },
  { value: "kindle", label: "Kindle" },
];

/** Cmd/Ctrl+K, opened globally from the app shell (AppLayoutInner). Actions
 * that already have a real handler elsewhere (theme, reading-stats toggle)
 * call straight through to the same functions Settings uses -- via
 * useDevicePrefs/useTheme, not a reimplementation. Navigate and Search
 * results are just links; there's nothing here a page-level `<Link>`
 * couldn't already do, the palette's value is having all of it in one
 * keyboard-reachable place. */
export function CommandPalette({ navItems, collections, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { showReadingStats, setShowReadingStats } = useDevicePrefs();
  const { isAuthenticated } = useAuth();
  const [query, setQuery] = useState("");
  // Tracks the selected *entry*, not a numeric index -- entries reorder as
  // you type, so a plain index would need resetting on every query change
  // (setState-in-effect, or a ref-during-render trick, both of which this
  // project's stricter react-hooks rules reject). Deriving the effective
  // index by looking the id up in the current `entries` list instead means
  // it naturally falls back to the top result the moment a selection
  // disappears from the list, with no reset logic needed at all.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<{ query: string; results: { id: string; title: string | null }[] }>({
    query: "",
    results: [],
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    const q = query.trim();
    if (!q) return; // stale/empty results are ignored at render time below, nothing to fetch
    let cancelled = false;
    const id = setTimeout(() => {
      searchLibrary(q, isAuthenticated).then((res) => {
        if (!cancelled) setSearchResults({ query: q, results: res.articles.slice(0, 5).map((a) => ({ id: a.id, title: a.title })) });
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query, isAuthenticated]);
  // Tagged with the query it was fetched for, same reasoning as reader-
  // view.tsx's relatedArticles -- avoids a setState-in-effect reset when
  // the query changes/clears (the stale results just stop being visible
  // once they no longer match the current query).
  const visibleSearchResults = searchResults.query === query.trim() ? searchResults.results : [];

  function go(href: string) {
    router.push(href);
    onClose();
  }

  const entries = useMemo<Entry[]>(() => {
    const results: Entry[] = [];

    for (const item of navItems) {
      const score = fuzzyScore(query, item.label);
      if (score !== null) {
        results.push({
          id: `nav:${item.href}`,
          group: "Navigate",
          label: item.label,
          Icon: item.Icon,
          run: () => go(item.href),
          score,
        });
      }
    }
    for (const c of collections) {
      const score = fuzzyScore(query, c.name);
      if (score !== null) {
        results.push({
          id: `collection:${c.id}`,
          group: "Navigate",
          label: c.name,
          sublabel: "Collection",
          Icon: IconFolder,
          run: () => go(`/library?collection=${c.id}`),
          score,
        });
      }
    }

    const actionCandidates: { label: string; sublabel?: string; run: () => void }[] = [
      ...THEMES.map((t) => ({
        label: `Theme: ${t.label}`,
        run: () => {
          setTheme(t.value);
          onClose();
        },
      })),
      {
        label: showReadingStats ? "Turn off Reading stats" : "Turn on Reading stats",
        run: () => {
          setShowReadingStats(!showReadingStats);
          onClose();
        },
      },
      { label: "Save an article", run: () => go("/library") },
      { label: "Empty trash", sublabel: "Opens Trash", run: () => go("/trash") },
    ];
    for (const a of actionCandidates) {
      const score = fuzzyScore(query, a.label);
      if (score !== null) {
        results.push({ id: `action:${a.label}`, group: "Actions", label: a.label, sublabel: a.sublabel, Icon: IconSearch, run: a.run, score });
      }
    }

    for (const r of visibleSearchResults) {
      results.push({
        id: `search:${r.id}`,
        group: "Search",
        label: r.title ?? "Untitled",
        sublabel: "Article",
        Icon: IconSearch,
        run: () => go(`/reader/${r.id}`),
        score: 50,
      });
    }

    return results.sort((a, b) => b.score - a.score);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- go() closes over router/onClose, stable enough for this list
  }, [query, navItems, collections, visibleSearchResults, showReadingStats, theme]);

  const foundIndex = selectedId ? entries.findIndex((e) => e.id === selectedId) : -1;
  const selectedIndex = foundIndex === -1 ? 0 : foundIndex;

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${selectedIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  function setSelectedIndex(indexOrUpdater: number | ((i: number) => number)) {
    const next = typeof indexOrUpdater === "function" ? indexOrUpdater(selectedIndex) : indexOrUpdater;
    setSelectedId(entries[next]?.id ?? null);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, entries.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      entries[selectedIndex]?.run();
    }
  }

  let runningIndex = -1;
  const groups: { name: string; entries: { entry: Entry; index: number }[] }[] = [];
  for (const entry of entries) {
    runningIndex++;
    const group = groups.find((g) => g.name === entry.group);
    if (group) group.entries.push({ entry, index: runningIndex });
    else groups.push({ name: entry.group, entries: [{ entry, index: runningIndex }] });
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-ink/40 px-4 pt-[15vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-md border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <IconSearch className="h-4 w-4 shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Jump to, search, or run a command…"
            aria-label="Command palette search"
            className="w-full bg-transparent font-sans text-sm text-ink outline-none placeholder:text-ink-faint"
          />
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto py-1.5" role="listbox">
          {entries.length === 0 ? (
            <p className="px-4 py-6 text-center font-sans text-sm text-ink-faint">No matches.</p>
          ) : (
            groups.map((g) => (
              <div key={g.name} className="px-1.5 py-1">
                <p className="px-2.5 py-1 font-sans text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  {g.name}
                </p>
                {g.entries.map(({ entry, index }) => (
                  <button
                    key={entry.id}
                    type="button"
                    data-index={index}
                    role="option"
                    aria-selected={index === selectedIndex}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => entry.run()}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left font-sans text-sm transition-colors",
                      index === selectedIndex ? "bg-surface-2 text-ink" : "text-ink-muted",
                    )}
                  >
                    <entry.Icon className="h-4 w-4 shrink-0 text-ink-faint" />
                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                    {entry.sublabel && (
                      <span className="shrink-0 font-sans text-xs text-ink-faint">{entry.sublabel}</span>
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
