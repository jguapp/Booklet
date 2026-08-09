import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Audio } from "expo-av";
import type { Article, ArticleStatus, Highlight, HighlightColor } from "@booklet/shared";
import { computeTextPosition, highlightColorHex, LEGACY_HIGHLIGHT_COLORS, toSafeTextChunks } from "@booklet/shared";
import {
  ApiError,
  loadArticle,
  renameArticle,
  updateArticleListeningPosition,
  updateArticleStatus,
} from "../lib/data/articles";
import { createHighlight, deleteHighlight, loadHighlights } from "../lib/data/highlights";
import { fetchTtsChunkAudio, type TtsChunkAudio } from "../lib/reader/read-aloud";
import { DEFAULT_PREFS, loadDevicePrefs, TEXT_SIZES, type DevicePrefs } from "../lib/device-prefs";
import { getDeviceId } from "../lib/device-id";
import { useTheme, type ThemePalette } from "../lib/theme";

interface ArticleScreenProps {
  articleId: string;
  authenticated: boolean;
  onBack: () => void;
}

// The swatch bar offers the legacy five only -- there is no color-picker UI
// here the way there is on the web. Rendering, below, must still cope with
// every other value: HighlightColor stopped being that five-value enum and is
// now any legacy name *or* a literal #RRGGBB, so a highlight colored from the
// web's curated palette or its color wheel syncs down here routinely. This
// list used to be a hand-copied duplicate of LEGACY_HIGHLIGHT_COLORS that
// rendering also looked the color up in, and a custom hex found no entry --
// backgroundColor came back undefined and the highlight rendered as plain,
// unmarked text. Imported from @booklet/shared now so the two can't drift,
// and rendering goes through highlightColorHex, which is written for exactly
// this non-theme-aware case.
const COLORS: { value: HighlightColor; hex: string; label: string }[] = LEGACY_HIGHLIGHT_COLORS.map((c) => ({
  value: c.id,
  hex: c.hex,
  label: c.label,
}));

// The same three states the web reader offers, in reading-life order.
const STATUSES: { value: ArticleStatus; label: string }[] = [
  { value: "UNREAD", label: "Unread" },
  { value: "READING", label: "Reading" },
  { value: "ARCHIVED", label: "Archived" },
];

interface Segment {
  key: string;
  text: string;
  highlight: Highlight | null;
}

// Only "text"-type positions are ever produced here -- mobile only deals in
// article.extractedText, never a PDF/EPUB position (see
// packages/shared/types/highlight-position.ts). A highlight whose stored
// offsets no longer fit the current text (extractedText changed since it
// was created) is skipped rather than mis-rendered.
function buildSegments(text: string, highlights: Highlight[]): Segment[] {
  const ranges = highlights
    .filter((h) => h.position.type === "text")
    .map((h) => ({ start: (h.position as { start: number }).start, end: (h.position as { end: number }).end, highlight: h }))
    .filter((r) => r.start >= 0 && r.end <= text.length && r.start < r.end)
    .sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue; // overlapping highlight -- skip rather than corrupt rendering
    if (range.start > cursor) segments.push({ key: `plain-${cursor}`, text: text.slice(cursor, range.start), highlight: null });
    segments.push({ key: range.highlight.id, text: text.slice(range.start, range.end), highlight: range.highlight });
    cursor = range.end;
  }
  if (cursor < text.length) segments.push({ key: `plain-${cursor}`, text: text.slice(cursor), highlight: null });
  return segments;
}

export function ArticleScreen({ articleId, authenticated, onBack }: ArticleScreenProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [article, setArticle] = useState<Article | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<DevicePrefs>(DEFAULT_PREFS);

  // Read-aloud player state. `listeningRef` mirrors `listening` for the
  // async paths: a chunk fetch that resolves after Stop was tapped must not
  // start playing into a dismissed player.
  const [listening, setListening] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [chunkIndex, setChunkIndex] = useState(0);
  const [chunkLoading, setChunkLoading] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const listeningRef = useRef(false);
  const soundRef = useRef<Audio.Sound | null>(null);
  // Fetched chunk audio, keyed by chunk index -- also the prefetch
  // mechanism (playChunk warms i+1). Promises so two callers for the same
  // index share one fetch. Failures are evicted so retry actually retries.
  const audioCacheRef = useRef<Map<number, Promise<TtsChunkAudio>>>(new Map());
  // 0..1 through the whole article; written to the server/local store on
  // pause, chunk boundaries and unmount -- never on every playback tick.
  // Only meaningful once playback has started: startedRef guards against
  // writing a position onto an article that was never listened to (null
  // listeningFraction means exactly that -- see saveArticleFromUrl).
  const fractionRef = useRef(0);
  const startedRef = useRef(false);

  useEffect(() => {
    // `cancelled` because tapping Back unmounts this screen while the fetch
    // is still in flight, and .catch below must not resurrect an error state
    // onto a screen the user has already left.
    let cancelled = false;
    Promise.all([loadArticle(articleId, authenticated), loadHighlights(articleId, authenticated)])
      .then(([a, h]) => {
        if (cancelled) return;
        setArticle(a);
        setHighlights(h);
      })
      .catch(() => {
        // Without this the rejection was unhandled and the screen fell
        // through to the same "Couldn't load that article" as a real 404 --
        // which told an offline reader their article was gone.
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [articleId, authenticated]);

  useEffect(() => {
    let cancelled = false;
    loadDevicePrefs().then((loaded) => {
      if (!cancelled) setPrefs(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Unmount teardown for the player: stop audio, release every staged chunk
  // (blob URLs on web, cache files on native), and flush the last position.
  // articleId/authenticated are props and fractionRef is a ref, so this
  // cleanup doesn't close over stale state.
  useEffect(() => {
    const audioCache = audioCacheRef.current;
    return () => {
      listeningRef.current = false;
      const sound = soundRef.current;
      soundRef.current = null;
      if (sound) void sound.unloadAsync().catch(() => undefined);
      for (const pending of audioCache.values()) {
        void pending.then((a) => a.cleanup()).catch(() => undefined);
      }
      audioCache.clear();
      if (startedRef.current) {
        void getDeviceId()
          .then((deviceId) => updateArticleListeningPosition(articleId, fractionRef.current, deviceId, authenticated))
          .catch(() => undefined);
      }
    };
  }, [articleId, authenticated]);

  const text = article?.extractedText ?? "";
  const segments = useMemo(() => buildSegments(text, highlights), [text, highlights]);
  const chunks = useMemo(() => toSafeTextChunks(text), [text]);
  const hasSelection = selection.end > selection.start;
  const textSize = TEXT_SIZES.find((s) => s.value === prefs.textSize) ?? TEXT_SIZES[1];
  const bodyStyle = [styles.body, { fontSize: textSize.fontSize, lineHeight: textSize.lineHeight }];

  function toggleSelecting() {
    setSelecting((prev) => !prev);
    setSelection({ start: 0, end: 0 });
  }

  async function handleHighlight(color: HighlightColor) {
    if (!article || !hasSelection || saving) return;
    setSaving(true);
    try {
      const position = computeTextPosition(text, selection.start, selection.end);
      const created = await createHighlight(
        { articleId: article.id, selectedText: position.exact, position, color },
        authenticated,
      );
      setHighlights((prev) => [...prev, created]);
      setSelecting(false);
      setSelection({ start: 0, end: 0 });
    } catch {
      Alert.alert("Couldn't save that highlight", "Try again.");
    } finally {
      setSaving(false);
    }
  }

  function getChunkAudio(i: number): Promise<TtsChunkAudio> {
    let pending = audioCacheRef.current.get(i);
    if (!pending) {
      pending = fetchTtsChunkAudio(chunks[i], prefs.ttsVoice, prefs.ttsRate);
      pending.catch(() => audioCacheRef.current.delete(i));
      audioCacheRef.current.set(i, pending);
    }
    return pending;
  }

  async function unloadSound() {
    const sound = soundRef.current;
    soundRef.current = null;
    if (sound) {
      try {
        await sound.unloadAsync();
      } catch {
        // already unloaded
      }
    }
  }

  function flushListeningPosition() {
    if (!startedRef.current) return;
    void getDeviceId()
      .then((deviceId) => updateArticleListeningPosition(articleId, fractionRef.current, deviceId, authenticated))
      .catch(() => undefined); // position sync is best-effort, never surfaced
  }

  async function playChunk(i: number) {
    if (i < 0 || i >= chunks.length) return;
    setChunkIndex(i);
    setChunkLoading(true);
    setTtsError(null);
    await unloadSound();
    try {
      const audio = await getChunkAudio(i);
      if (!listeningRef.current) return; // stopped while the fetch was in flight
      // Warm the next chunk while this one plays, so the boundary is a cache
      // hit instead of a multi-second silence -- the same reasoning as the
      // web player's prefetch.
      if (i + 1 < chunks.length) void getChunkAudio(i + 1).catch(() => undefined);

      const { sound } = await Audio.Sound.createAsync({ uri: audio.uri }, { shouldPlay: true });
      if (!listeningRef.current) {
        void sound.unloadAsync().catch(() => undefined);
        return;
      }
      soundRef.current = sound;
      startedRef.current = true;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        if (status.durationMillis) {
          fractionRef.current = Math.min(
            1,
            (i + (status.positionMillis ?? 0) / status.durationMillis) / chunks.length,
          );
        }
        setPlaying(status.isPlaying);
        if (status.didJustFinish) {
          flushListeningPosition();
          if (i + 1 < chunks.length) void playChunk(i + 1);
          else void stopListening();
        }
      });
      setPlaying(true);
    } catch (err) {
      setTtsError(err instanceof ApiError ? err.message : "Couldn't fetch audio. Check your connection.");
      setPlaying(false);
    } finally {
      setChunkLoading(false);
    }
  }

  async function startListening() {
    listeningRef.current = true;
    setListening(true);
    // Without this, iOS's silent switch mutes playback entirely -- read-aloud
    // is exactly the kind of deliberate audio the silent switch isn't meant
    // to cover (same category as a podcast app).
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true }).catch(() => undefined);
    // Resume where any device left off -- listeningFraction maps back to a
    // chunk index. A finished article (fraction 1) starts over instead of
    // resuming onto the last syllable.
    const fraction = article?.listeningFraction ?? 0;
    const resumeChunk = fraction >= 1 ? 0 : Math.min(chunks.length - 1, Math.floor(fraction * chunks.length));
    await playChunk(resumeChunk);
  }

  async function togglePlayPause() {
    const sound = soundRef.current;
    if (!sound) return;
    try {
      const status = await sound.getStatusAsync();
      if (!status.isLoaded) return;
      if (status.isPlaying) {
        await sound.pauseAsync();
        flushListeningPosition();
      } else {
        await sound.playAsync();
      }
    } catch {
      // sound was torn down between the tap and the call
    }
  }

  async function stopListening() {
    listeningRef.current = false;
    setListening(false);
    setPlaying(false);
    await unloadSound();
    flushListeningPosition();
  }

  async function handleSetStatus(status: ArticleStatus) {
    if (!article || article.status === status) return;
    const previous = article;
    // Optimistic, reverted on failure -- but committed from the server's
    // response on success, because updateArticleStatus also derives
    // readAt/archivedAt and this screen's copy must not drift from what was
    // actually stored.
    setArticle({ ...article, status });
    setActionError(null);
    try {
      setArticle(await updateArticleStatus(previous, status, authenticated));
    } catch {
      setArticle(previous);
      setActionError("Couldn't update the status. Try again.");
    }
  }

  // Explicit Save/Cancel rather than submit-on-blur: LibraryScreen's
  // collection input needed a ref guard because Done-press also blurs and
  // fired its handler twice. Two buttons can't double-fire.
  async function handleRename() {
    if (!article) return;
    const cleaned = titleDraft.trim();
    setRenaming(false);
    if (!cleaned || cleaned === (article.title ?? "")) return;
    const previous = article;
    setArticle({ ...article, title: cleaned });
    setActionError(null);
    try {
      setArticle(await renameArticle(previous, cleaned, authenticated));
    } catch {
      setArticle(previous);
      setActionError("Couldn't rename that. Try again.");
    }
  }

  function confirmRemoveHighlight(highlight: Highlight) {
    Alert.alert("Remove highlight?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteHighlight(highlight.id, authenticated);
          } catch {
            // The list is only updated after the delete lands, so a failure
            // leaves the highlight painted, which is the truth. Previously
            // this rejected into nothing and the tap just appeared to do
            // nothing at all.
            Alert.alert("Couldn't remove that highlight", "Try again.");
            return;
          }
          setHighlights((prev) => prev.filter((h) => h.id !== highlight.id));
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!article) {
    return (
      <View style={styles.center}>
        <Text>
          {loadFailed
            ? "Couldn't reach Booklet. Check your connection and try again."
            : "Couldn't load that article."}
        </Text>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>Back to Library</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>← Library</Text>
        </TouchableOpacity>
        {text.length > 0 && (
          <View style={styles.topBarActions}>
            {!listening && (
              <TouchableOpacity onPress={startListening}>
                <Text style={styles.selectToggle}>🔊 Listen</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={toggleSelecting}>
              <Text style={styles.selectToggle}>{selecting ? "Done" : "Select text"}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {renaming ? (
          <View style={styles.renameRow}>
            <TextInput
              style={styles.renameInput}
              autoFocus
              value={titleDraft}
              onChangeText={setTitleDraft}
              placeholderTextColor={palette.inkFaint}
              placeholder="Article title"
            />
            <TouchableOpacity onPress={handleRename}>
              <Text style={styles.renameAction}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setRenaming(false)}>
              <Text style={styles.renameCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={styles.title}>{article.title ?? "Untitled"}</Text>
        )}
        <Text style={styles.meta}>{article.siteName ?? article.author ?? article.sourceType}</Text>

        <View style={styles.manageRow}>
          {STATUSES.map((s) => (
            <TouchableOpacity
              key={s.value}
              style={[styles.statusChip, article.status === s.value && styles.statusChipActive]}
              onPress={() => handleSetStatus(s.value)}
            >
              <Text style={[styles.statusChipText, article.status === s.value && styles.statusChipTextActive]}>
                {s.label}
              </Text>
            </TouchableOpacity>
          ))}
          {!renaming && (
            <TouchableOpacity
              onPress={() => {
                setTitleDraft(article.title ?? "");
                setRenaming(true);
              }}
            >
              <Text style={styles.renameLink}>Rename</Text>
            </TouchableOpacity>
          )}
        </View>
        {actionError && <Text style={styles.actionError}>{actionError}</Text>}

        {selecting ? (
          // A plain multiline Text can't report a user's selection range or
          // give per-substring styling at the same time -- RN has no single
          // "selectable rich text" primitive. TextInput is the only
          // component that exposes onSelectionChange, so highlighting is a
          // toggled mode: select in a plain (edit-blocked) TextInput, view
          // highlights as styled Text segments otherwise. See README.md's
          // Verified section for what is and isn't confirmed on native.
          <TextInput
            style={bodyStyle}
            multiline
            value={text}
            showSoftInputOnFocus={false}
            onChangeText={() => {
              /* no-op: value stays bound to `text`, so RN reverts any edit */
            }}
            onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
          />
        ) : text ? (
          <Text style={bodyStyle}>
            {segments.map((seg) =>
              seg.highlight ? (
                <Text
                  key={seg.key}
                  style={{ backgroundColor: highlightColorHex(seg.highlight.color) }}
                  onPress={() => confirmRemoveHighlight(seg.highlight!)}
                >
                  {seg.text}
                </Text>
              ) : (
                <Text key={seg.key}>{seg.text}</Text>
              ),
            )}
          </Text>
        ) : (
          <Text style={bodyStyle}>No readable content for this article.</Text>
        )}
      </ScrollView>

      {listening && (
        <View style={styles.playerBar}>
          {ttsError && <Text style={styles.playerError}>{ttsError}</Text>}
          <View style={styles.playerControls}>
            <TouchableOpacity onPress={() => playChunk(chunkIndex - 1)} disabled={chunkIndex === 0}>
              <Text style={[styles.playerButton, chunkIndex === 0 && styles.playerButtonDisabled]}>⏮</Text>
            </TouchableOpacity>
            {chunkLoading ? (
              <ActivityIndicator />
            ) : ttsError ? (
              // Retry re-enters playChunk for the same index; the failed
              // fetch was evicted from the cache, so this is a real retry.
              <TouchableOpacity onPress={() => playChunk(chunkIndex)}>
                <Text style={styles.playerButton}>↻</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={togglePlayPause}>
                <Text style={styles.playerButton}>{playing ? "⏸" : "▶"}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => playChunk(chunkIndex + 1)} disabled={chunkIndex >= chunks.length - 1}>
              <Text style={[styles.playerButton, chunkIndex >= chunks.length - 1 && styles.playerButtonDisabled]}>
                ⏭
              </Text>
            </TouchableOpacity>
            <Text style={styles.playerProgress}>
              {chunkIndex + 1} / {chunks.length}
            </Text>
            <TouchableOpacity onPress={stopListening}>
              <Text style={styles.playerClose}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {selecting && hasSelection && (
        <View style={styles.colorBar}>
          {COLORS.map((c) => (
            <TouchableOpacity
              key={c.value}
              accessibilityLabel={c.label}
              disabled={saving}
              style={[styles.swatch, { backgroundColor: c.hex }]}
              onPress={() => handleHighlight(c.value)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const makeStyles = (t: ThemePalette) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: t.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: t.paper },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 56,
    paddingHorizontal: 20,
  },
  scroll: { flex: 1 },
  content: { padding: 20, paddingTop: 12 },
  back: { color: t.accent, fontSize: 14, fontWeight: "600" },
  topBarActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  selectToggle: { color: t.accent, fontSize: 14, fontWeight: "600" },
  playerBar: {
    borderTopWidth: 1,
    borderTopColor: t.border,
    backgroundColor: t.surface,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  playerError: { color: t.danger, fontSize: 12, marginBottom: 6, textAlign: "center" },
  playerControls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 22 },
  playerButton: { fontSize: 22, color: t.ink },
  playerButtonDisabled: { color: t.inkFaint },
  playerProgress: { fontSize: 12, color: t.inkMuted, minWidth: 52, textAlign: "center" },
  playerClose: { fontSize: 16, color: t.inkMuted },
  title: { fontSize: 24, fontWeight: "700", color: t.ink, marginBottom: 4 },
  meta: { fontSize: 13, color: t.inkMuted, marginBottom: 12 },
  manageRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" },
  statusChip: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: t.surface,
  },
  statusChipActive: { borderColor: t.accent, backgroundColor: t.accentSoft },
  statusChipText: { fontSize: 12, color: t.inkMuted },
  statusChipTextActive: { color: t.accent, fontWeight: "600" },
  renameLink: { fontSize: 12, fontWeight: "600", color: t.inkMuted, marginLeft: 6 },
  renameRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
  renameInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 6,
    padding: 8,
    backgroundColor: t.surface,
    fontSize: 16,
    fontWeight: "600",
      color: t.ink,
  },
  renameAction: { fontSize: 13, fontWeight: "600", color: t.accent },
  renameCancel: { fontSize: 13, fontWeight: "600", color: t.inkMuted },
  actionError: { color: t.danger, fontSize: 12, marginBottom: 12 },
  body: { fontSize: 16, lineHeight: 26, color: t.ink },
  colorBar: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: t.border,
    backgroundColor: t.surface,
  },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: t.border },
});
