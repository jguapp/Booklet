import { useEffect, useMemo, useState } from "react";
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
import type { Article, ArticleStatus, Highlight, HighlightColor } from "@booklet/shared";
import { computeTextPosition, highlightColorHex, LEGACY_HIGHLIGHT_COLORS } from "@booklet/shared";
import { loadArticle, renameArticle, updateArticleStatus } from "../lib/data/articles";
import { createHighlight, deleteHighlight, loadHighlights } from "../lib/data/highlights";

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

  const text = article?.extractedText ?? "";
  const segments = useMemo(() => buildSegments(text, highlights), [text, highlights]);
  const hasSelection = selection.end > selection.start;

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
          <TouchableOpacity onPress={toggleSelecting}>
            <Text style={styles.selectToggle}>{selecting ? "Done" : "Select text"}</Text>
          </TouchableOpacity>
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
            style={styles.body}
            multiline
            value={text}
            showSoftInputOnFocus={false}
            onChangeText={() => {
              /* no-op: value stays bound to `text`, so RN reverts any edit */
            }}
            onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
          />
        ) : text ? (
          <Text style={styles.body}>
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
          <Text style={styles.body}>No readable content for this article.</Text>
        )}
      </ScrollView>

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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f7f4ee" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#f7f4ee" },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 56,
    paddingHorizontal: 20,
  },
  scroll: { flex: 1 },
  content: { padding: 20, paddingTop: 12 },
  back: { color: "#b5502f", fontSize: 14, fontWeight: "600" },
  selectToggle: { color: "#1F6F6B", fontSize: 14, fontWeight: "600" },
  title: { fontSize: 24, fontWeight: "700", color: "#1c1a16", marginBottom: 4 },
  meta: { fontSize: 13, color: "#6b6558", marginBottom: 12 },
  manageRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" },
  statusChip: {
    borderWidth: 1,
    borderColor: "#ddd6c7",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: "#fff",
  },
  statusChipActive: { borderColor: "#b5502f", backgroundColor: "#fbe9e3" },
  statusChipText: { fontSize: 12, color: "#6b6558" },
  statusChipTextActive: { color: "#b5502f", fontWeight: "600" },
  renameLink: { fontSize: 12, fontWeight: "600", color: "#6b6558", marginLeft: 6 },
  renameRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
  renameInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd6c7",
    borderRadius: 6,
    padding: 8,
    backgroundColor: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  renameAction: { fontSize: 13, fontWeight: "600", color: "#b5502f" },
  renameCancel: { fontSize: 13, fontWeight: "600", color: "#6b6558" },
  actionError: { color: "#b5502f", fontSize: 12, marginBottom: 12 },
  body: { fontSize: 16, lineHeight: 26, color: "#1c1a16" },
  colorBar: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: "#ece6d8",
    backgroundColor: "#fff",
  },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: "#ddd6c7" },
});
