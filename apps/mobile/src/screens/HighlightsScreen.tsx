import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { Article, Highlight } from "@booklet/shared";
import { highlightColorHex } from "@booklet/shared";
import { loadArticles } from "../lib/data/articles";
import { deleteHighlight, deleteNote, loadHighlights, saveHighlightPrompt, saveNote } from "../lib/data/highlights";
import { useTheme, type ThemePalette } from "../lib/theme";

interface HighlightsScreenProps {
  authenticated: boolean;
  onBack: () => void;
  onOpenArticle: (id: string) => void;
}

// Mirrors the web app's /highlights page, minus sharing and onboarding
// seeds: grouped-by-article cards when browsing everything, a flat list once
// an article is picked or a search is typed, and per-highlight notes, recall
// prompts (#157), and delete. One editor is open at a time -- `editing`
// carries which highlight and which field, so the two TextInputs can't
// fight over focus.
type Editing = { id: string; field: "note" | "prompt"; draft: string } | null;

export function HighlightsScreen({ authenticated, onBack, onOpenArticle }: HighlightsScreenProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [articleFilter, setArticleFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  // Two-step delete, same convention as TrashScreen: Alert.alert is a no-op
  // on react-native-web, the one target this app runs on today.
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [a, h] = await Promise.all([loadArticles(authenticated), loadHighlights(undefined, authenticated)]);
      setArticles(a);
      setHighlights(h);
      setError(null);
    } catch {
      setError("Couldn't load your highlights. Pull down to retry.");
    }
  }, [authenticated]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refresh().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const articleById = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);
  const isSearching = search.trim().length > 0;
  const showingOneArticle = articleFilter !== "ALL";

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = highlights
      .filter((h) => articleFilter === "ALL" || h.articleId === articleFilter)
      .filter(
        (h) =>
          !needle ||
          h.selectedText.toLowerCase().includes(needle) ||
          !!h.annotation?.noteText.toLowerCase().includes(needle),
      );
    // Scoped to one article: reading order. Mobile only ever creates "text"
    // positions (see ArticleScreen), so position.start is the whole ordering
    // -- no need for the web's comparePositionInArticle, which also ranks
    // PDF/EPUB position types this app never produces. Mixed articles:
    // creation order, the only order that means anything across books.
    return showingOneArticle
      ? filtered.sort((a, b) => {
          const aStart = a.position.type === "text" ? a.position.start : 0;
          const bStart = b.position.type === "text" ? b.position.start : 0;
          return aStart - bStart;
        })
      : filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [highlights, articleFilter, search, showingOneArticle]);

  const groups = useMemo(() => {
    const byArticle = new Map<string, Highlight[]>();
    for (const h of highlights) {
      const list = byArticle.get(h.articleId);
      if (list) list.push(h);
      else byArticle.set(h.articleId, [h]);
    }
    return Array.from(byArticle.entries())
      .map(([articleId, hs]) => ({
        articleId,
        title: articleById.get(articleId)?.title ?? "Untitled",
        count: hs.length,
        mostRecentAt: Math.max(...hs.map((h) => new Date(h.createdAt).getTime())),
      }))
      .sort((a, b) => b.mostRecentAt - a.mostRecentAt);
  }, [highlights, articleById]);

  // Grouping only means something with 2+ articles -- with one, it's a
  // single card hiding the highlights behind an extra tap. Same rule as web.
  const showGrouped = !showingOneArticle && !isSearching && groups.length > 1;

  function applyUpdated(updated: Highlight) {
    setHighlights((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
  }

  async function handleDelete(h: Highlight) {
    setConfirmingDelete(null);
    setHighlights((prev) => prev.filter((x) => x.id !== h.id));
    setError(null);
    try {
      await deleteHighlight(h.id, authenticated);
    } catch {
      setHighlights((prev) => [h, ...prev]);
      setError("Couldn't delete that highlight. Try again.");
    }
  }

  async function handleSaveEdit(h: Highlight) {
    if (!editing || editing.id !== h.id) return;
    const draft = editing.draft.trim();
    setEditing(null);
    setError(null);
    try {
      if (editing.field === "note") {
        // An emptied note is a removal, matching what the reader means by
        // clearing the box -- the web page has a separate delete control,
        // but here empty-and-save is the natural gesture.
        applyUpdated(draft ? await saveNote(h, draft, authenticated) : await deleteNote(h, authenticated));
      } else {
        applyUpdated(await saveHighlightPrompt(h, draft || null, authenticated));
      }
    } catch {
      setError("Couldn't save that. Try again.");
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const selectedTitle = showingOneArticle ? (articleById.get(articleFilter)?.title ?? "Untitled") : null;

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={showingOneArticle ? () => setArticleFilter("ALL") : onBack}>
        <Text style={styles.back}>{showingOneArticle ? "← All highlights" : "← Library"}</Text>
      </TouchableOpacity>
      <Text style={styles.title}>{selectedTitle ?? "Highlights"}</Text>
      {selectedTitle && (
        <TouchableOpacity onPress={() => onOpenArticle(articleFilter)}>
          <Text style={styles.openArticleLink}>Open article</Text>
        </TouchableOpacity>
      )}
      <TextInput
        style={styles.search}
        placeholderTextColor={palette.inkFaint}
        placeholder="Search highlights and notes"
        autoCapitalize="none"
        value={search}
        onChangeText={setSearch}
        clearButtonMode="while-editing"
      />
      {error && <Text style={styles.error}>{error}</Text>}

      {showGrouped ? (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.articleId}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await refresh();
                setRefreshing(false);
              }}
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.groupCard} onPress={() => setArticleFilter(item.articleId)}>
              <Text style={styles.groupTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.groupCount}>
                {item.count} highlight{item.count === 1 ? "" : "s"}
              </Text>
            </TouchableOpacity>
          )}
        />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(h) => h.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await refresh();
                setRefreshing(false);
              }}
            />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              {isSearching
                ? "No highlights match that search."
                : "No highlights yet. Select text in an article to create one."}
            </Text>
          }
          renderItem={({ item }) => {
            const isEditingNote = editing?.id === item.id && editing.field === "note";
            const isEditingPrompt = editing?.id === item.id && editing.field === "prompt";
            return (
              <View style={styles.card}>
                <TouchableOpacity
                  style={[styles.quoteRow, { borderLeftColor: highlightColorHex(item.color) }]}
                  onPress={() => onOpenArticle(item.articleId)}
                >
                  <Text style={styles.quote}>{item.selectedText}</Text>
                  {!showingOneArticle && (
                    <Text style={styles.quoteMeta} numberOfLines={1}>
                      {articleById.get(item.articleId)?.title ?? "Untitled"}
                    </Text>
                  )}
                </TouchableOpacity>

                {isEditingNote || isEditingPrompt ? (
                  <View>
                    <TextInput
                      style={styles.editorInput}
                      multiline
                      autoFocus
                      placeholderTextColor={palette.inkFaint}
                      placeholder={isEditingNote ? "Your note" : "e.g. What are the three causes the author gives?"}
                      value={editing!.draft}
                      onChangeText={(draft) => setEditing((prev) => (prev ? { ...prev, draft } : prev))}
                    />
                    <View style={styles.actionsRow}>
                      <TouchableOpacity onPress={() => handleSaveEdit(item)}>
                        <Text style={styles.actionStrong}>Save</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setEditing(null)}>
                        <Text style={styles.action}>Cancel</Text>
                      </TouchableOpacity>
                      {isEditingPrompt && (
                        <Text style={styles.editorHint}>Shown as a question in Daily Review before the reveal.</Text>
                      )}
                    </View>
                  </View>
                ) : (
                  <>
                    {item.annotation && <Text style={styles.note}>{item.annotation.noteText}</Text>}
                    {item.prompt && <Text style={styles.prompt}>Prompt: {item.prompt}</Text>}
                    <View style={styles.actionsRow}>
                      <TouchableOpacity
                        onPress={() =>
                          setEditing({ id: item.id, field: "note", draft: item.annotation?.noteText ?? "" })
                        }
                      >
                        <Text style={styles.action}>{item.annotation ? "Edit note" : "Add note"}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setEditing({ id: item.id, field: "prompt", draft: item.prompt ?? "" })}
                      >
                        <Text style={styles.action}>{item.prompt ? "Edit prompt" : "Add prompt"}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => (confirmingDelete === item.id ? handleDelete(item) : setConfirmingDelete(item.id))}
                      >
                        <Text style={styles.actionDanger}>
                          {confirmingDelete === item.id ? "Tap to confirm" : "Delete"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const makeStyles = (t: ThemePalette) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: t.paper, paddingTop: 56, paddingHorizontal: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.paper },
  back: { color: t.accent, fontSize: 14, fontWeight: "600", marginBottom: 12 },
  title: { fontSize: 24, fontWeight: "700", color: t.ink, marginBottom: 4 },
  openArticleLink: { color: t.accent, fontSize: 13, fontWeight: "600", marginBottom: 8 },
  search: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 6,
    padding: 10,
    backgroundColor: t.surface,
    fontSize: 14,
    marginTop: 8,
    marginBottom: 12,
      color: t.ink,
  },
  error: { color: t.danger, fontSize: 12, marginBottom: 8 },
  empty: { textAlign: "center", color: t.inkMuted, marginTop: 40 },
  groupCard: {
    backgroundColor: t.surface,
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: t.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  groupTitle: { flex: 1, fontSize: 16, fontWeight: "600", color: t.ink },
  groupCount: { fontSize: 12, color: t.inkMuted },
  card: {
    backgroundColor: t.surface,
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: t.border,
  },
  quoteRow: { borderLeftWidth: 3, paddingLeft: 10, marginBottom: 8 },
  quote: { fontSize: 15, lineHeight: 22, color: t.ink },
  quoteMeta: { fontSize: 12, color: t.inkMuted, marginTop: 4 },
  note: { fontSize: 13, color: t.inkMuted, marginBottom: 6, fontStyle: "italic" },
  prompt: { fontSize: 13, color: t.accent, marginBottom: 6 },
  actionsRow: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 2 },
  action: { fontSize: 13, fontWeight: "600", color: t.inkMuted },
  actionStrong: { fontSize: 13, fontWeight: "600", color: t.accent },
  actionDanger: { fontSize: 13, fontWeight: "600", color: t.danger },
  editorInput: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 6,
    padding: 10,
    backgroundColor: t.surface,
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: "top",
    marginBottom: 8,
      color: t.ink,
  },
  editorHint: { flex: 1, fontSize: 11, color: t.inkMuted },
});
