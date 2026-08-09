import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import type { Article, Collection } from "@booklet/shared";
import { clearSession } from "../lib/api";
import {
  ApiError,
  loadArticles,
  saveArticleFromFile,
  saveArticleFromUrl,
  trashArticle,
  updateArticleFavorited,
} from "../lib/data/articles";
import {
  addArticleToCollection,
  createCollection,
  loadArticleIdsInCollection,
  loadCollections,
  removeArticleFromCollection,
} from "../lib/data/collections";
import { useTheme, type ThemePalette } from "../lib/theme";

interface LibraryScreenProps {
  authenticated: boolean;
  onOpenArticle: (id: string) => void;
  onOpenDailyReview: () => void;
  onOpenFavorites: () => void;
  onOpenHighlights: () => void;
  onOpenStats: () => void;
  onOpenRss: () => void;
  onOpenSettings: () => void;
  onOpenTrash: () => void;
  onSignedOut: () => void;
  /** Set when logging in couldn't move this device's local library onto the
   * account (see App.tsx). Shown here rather than in an Alert because it is
   * about the list the user is looking at, and because react-native-web's
   * Alert.alert is a no-op -- an Alert would be invisible on the one target
   * this app can actually be run on today. */
  migrationNotice?: string | null;
}

export function LibraryScreen({
  authenticated,
  onOpenArticle,
  onOpenDailyReview,
  onOpenFavorites,
  onOpenHighlights,
  onOpenStats,
  onOpenRss,
  onOpenSettings,
  onOpenTrash,
  onSignedOut,
  migrationNotice,
}: LibraryScreenProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [collectionMemberIds, setCollectionMemberIds] = useState<Set<string> | null>(null);
  const [addingCollection, setAddingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [loadedArticles, loadedCollections] = await Promise.all([
        loadArticles(authenticated),
        loadCollections(authenticated),
      ]);
      setArticles(loadedArticles);
      setCollections(loadedCollections);
      setError(null);
    } catch {
      // Keep whatever was already loaded -- but say so. Swallowing this
      // silently meant the very first load of a signed-in library with the
      // API unreachable rendered "Nothing here yet.", which reads as "your
      // library is empty" rather than "we couldn't fetch it".
      setError("Couldn't load your library. Pull down to retry.");
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

  // Membership of the currently-selected collection -- drives both the
  // filtered list and each card's add/remove toggle state. Re-fetched
  // whenever the selected collection changes; "All" (null) needs none of this.
  useEffect(() => {
    if (!activeCollectionId) {
      setCollectionMemberIds(null);
      return;
    }
    let cancelled = false;
    loadArticleIdsInCollection(activeCollectionId, authenticated)
      .then((ids) => {
        if (!cancelled) setCollectionMemberIds(ids);
      })
      .catch(() => {
        // Unhandled before this. With memberIds left null every card's
        // toggle silently no-ops (toggleMembership returns early on null),
        // so the collection looked usable and simply refused to work.
        if (!cancelled) setError("Couldn't load that collection's contents.");
      });
    return () => {
      cancelled = true;
    };
  }, [activeCollectionId, authenticated]);

  async function handleSave() {
    if (!url.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const article = await saveArticleFromUrl(url.trim(), authenticated);
      setArticles((prev) => [article, ...prev]);
      setUrl("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save that URL.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUploadFile() {
    // Inside the try, not before it: getDocumentAsync rejects on its own
    // (a denied storage permission, a provider that fails to hand the file
    // over), and outside a handler that became an unhandled rejection from
    // an onPress -- the row just did nothing when tapped.
    setError(null);
    let asset: DocumentPicker.DocumentPickerAsset;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "application/epub+zip"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets[0]) return;
      asset = result.assets[0];
    } catch {
      setError("Couldn't open the file picker.");
      return;
    }

    setSaving(true);
    try {
      const article = await saveArticleFromFile(
        { uri: asset.uri, name: asset.name, mimeType: asset.mimeType, webFile: asset.file },
        authenticated,
      );
      setArticles((prev) => [article, ...prev]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't upload that file.");
    } finally {
      setSaving(false);
    }
  }

  // Both onSubmitEditing (Enter/Done) and onBlur (tapping away) call this,
  // so a Done-press -- which blurs the input as a side effect -- can fire
  // it twice in quick succession, both reads landing before React commits
  // the first call's state updates. creatingCollectionRef makes the second
  // call a no-op instead of a duplicate create (caught by hand: the second
  // call was reaching the server and coming back "already exists").
  const creatingCollectionRef = useRef(false);
  async function handleCreateCollection() {
    if (creatingCollectionRef.current) return;
    const name = newCollectionName.trim();
    if (!name) {
      setAddingCollection(false);
      return;
    }
    creatingCollectionRef.current = true;
    try {
      const created = await createCollection(name, authenticated);
      setCollections((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setActiveCollectionId(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create that collection.");
    } finally {
      setNewCollectionName("");
      setAddingCollection(false);
      creatingCollectionRef.current = false;
    }
  }

  async function toggleMembership(articleId: string) {
    if (!activeCollectionId || !collectionMemberIds) return;
    const isMember = collectionMemberIds.has(articleId);
    const applyLocally = (member: boolean) =>
      setCollectionMemberIds((prev) => {
        const next = new Set(prev);
        if (member) next.add(articleId);
        else next.delete(articleId);
        return next;
      });

    applyLocally(!isMember);
    setError(null);
    try {
      if (isMember) await removeArticleFromCollection(articleId, activeCollectionId, authenticated);
      else await addArticleToCollection(articleId, activeCollectionId, authenticated);
    } catch (err) {
      // The optimistic tick was previously left standing on failure, and the
      // rejection went unhandled -- so a rejected add (the API refuses one on
      // a smart collection, whose membership it computes) showed a ✓ that
      // vanished on the next refresh with nothing said in between.
      applyLocally(isMember);
      setError(err instanceof ApiError ? err.message : "Couldn't update that collection.");
    }
  }

  async function handleAccountAction() {
    if (authenticated) {
      try {
        await clearSession();
      } catch {
        // Staying put on purpose. If the token is still in storage the user
        // is still logged in, and App.tsx's startup check reads that same key
        // -- so showing them the login screen would be a claim this device
        // cannot back up, and the next launch would silently sign them back
        // in. Previously this rejected into nothing and the tap did nothing.
        setError("Couldn't log out on this device. Try again.");
        return;
      }
    }
    onSignedOut();
  }

  async function handleToggleFavorite(article: Article) {
    const next = !article.favorited;
    // Optimistic; revert on failure.
    setArticles((prev) => prev.map((a) => (a.id === article.id ? { ...a, favorited: next } : a)));
    setError(null);
    try {
      await updateArticleFavorited(article, next, authenticated);
    } catch {
      setArticles((prev) => prev.map((a) => (a.id === article.id ? { ...a, favorited: !next } : a)));
      setError("Couldn't update that. Try again.");
    }
  }

  // A soft delete -- the article moves to Trash (restorable for 30 days), so
  // a single tap without a confirm is fine here, unlike Trash's own
  // delete-forever. Dropped from the list optimistically.
  async function handleTrash(article: Article) {
    setArticles((prev) => prev.filter((a) => a.id !== article.id));
    setError(null);
    try {
      await trashArticle(article, authenticated);
    } catch {
      setArticles((prev) => [article, ...prev]);
      setError("Couldn't delete that. Try again.");
    }
  }

  // Selecting a collection shows every article (not just members) with a
  // +/checkmark toggle -- filtering down to members-only would hide exactly
  // the non-member articles the toggle exists to add, since a hidden card's
  // button can never be tapped. Membership is still visually obvious (✓ vs
  // +), so this doubles as "browse this collection"'s checked-off view.
  //
  // Search narrows the same list by title/site/author/excerpt, client-side --
  // there's no mobile search endpoint, and the whole library is already in
  // hand here.
  const needle = search.trim().toLowerCase();
  const visibleArticles = needle
    ? articles.filter((a) =>
        [a.title, a.siteName, a.author, a.excerpt].some((f) => (f ?? "").toLowerCase().includes(needle)),
      )
    : articles;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Library</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={onOpenDailyReview}>
            <Text style={styles.dailyReviewLink}>Daily Review</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleAccountAction}>
            <Text style={styles.logout}>{authenticated ? "Log out" : "Log in to sync"}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.navRow}>
        <TouchableOpacity onPress={onOpenFavorites}>
          <Text style={styles.navLink}>★ Favorites</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onOpenHighlights}>
          <Text style={styles.navLink}>✎ Highlights</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onOpenStats}>
          <Text style={styles.navLink}>▤ Stats</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onOpenRss}>
          <Text style={styles.navLink}>◈ RSS</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onOpenTrash}>
          <Text style={styles.navLink}>🗑 Trash</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onOpenSettings}>
          <Text style={styles.navLink}>⚙ Settings</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.saveRow}>
        <TextInput
          style={styles.input}
          placeholderTextColor={palette.inkFaint}
          placeholder="Paste a URL to save"
          autoCapitalize="none"
          value={url}
          onChangeText={setUrl}
        />
        <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color={palette.accentContrast} size="small" /> : <Text style={styles.saveButtonText}>Save</Text>}
        </TouchableOpacity>
      </View>
      <TouchableOpacity onPress={handleUploadFile} disabled={saving} style={styles.uploadRow}>
        <Text style={styles.uploadText}>Or upload a PDF / EPUB</Text>
      </TouchableOpacity>
      <TextInput
        style={styles.search}
        placeholderTextColor={palette.inkFaint}
        placeholder="Search your library"
        autoCapitalize="none"
        value={search}
        onChangeText={setSearch}
        clearButtonMode="while-editing"
      />
      {migrationNotice && <Text style={styles.error}>{migrationNotice}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={{ gap: 6 }}>
        <TouchableOpacity
          style={[styles.chip, activeCollectionId === null && styles.chipActive]}
          onPress={() => setActiveCollectionId(null)}
        >
          <Text style={[styles.chipText, activeCollectionId === null && styles.chipTextActive]}>All</Text>
        </TouchableOpacity>
        {collections.map((c) => (
          <TouchableOpacity
            key={c.id}
            style={[styles.chip, activeCollectionId === c.id && styles.chipActive]}
            onPress={() => setActiveCollectionId(c.id)}
          >
            <Text style={[styles.chipText, activeCollectionId === c.id && styles.chipTextActive]}>{c.name}</Text>
          </TouchableOpacity>
        ))}
        {addingCollection ? (
          <TextInput
            style={styles.newCollectionInput}
            placeholderTextColor={palette.inkFaint}
            placeholder="Collection name"
            autoFocus
            value={newCollectionName}
            onChangeText={setNewCollectionName}
            onSubmitEditing={handleCreateCollection}
            onBlur={handleCreateCollection}
          />
        ) : (
          <TouchableOpacity style={styles.chip} onPress={() => setAddingCollection(true)}>
            <Text style={styles.chipText}>+ New</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
      {activeCollectionId && (
        <Text style={styles.hint}>Tap ＋ to add an article to &ldquo;{collections.find((c) => c.id === activeCollectionId)?.name}&rdquo;, ✓ to remove it.</Text>
      )}

      <FlatList
        data={visibleArticles}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => {
          setRefreshing(true);
          await refresh();
          setRefreshing(false);
        }} />}
        ListEmptyComponent={
          <Text style={styles.empty}>Nothing here yet.</Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => onOpenArticle(item.id)}>
            <View style={styles.cardRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{item.title ?? "Untitled"}</Text>
                <Text style={styles.cardMeta}>
                  {item.siteName ?? item.author ?? item.sourceType} · {item.status}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => handleToggleFavorite(item)}
                accessibilityLabel={item.favorited ? "Remove from favorites" : "Add to favorites"}
              >
                <Text style={item.favorited ? styles.starActive : styles.starInactive}>{item.favorited ? "★" : "☆"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconButton} onPress={() => handleTrash(item)} accessibilityLabel="Delete">
                <Text style={styles.deleteGlyph}>🗑</Text>
              </TouchableOpacity>
              {activeCollectionId && (
                <TouchableOpacity
                  style={[styles.memberButton, collectionMemberIds?.has(item.id) && styles.memberButtonActive]}
                  onPress={() => toggleMembership(item.id)}
                >
                  <Text style={[styles.memberButtonText, collectionMemberIds?.has(item.id) && styles.memberButtonTextActive]}>
                    {collectionMemberIds?.has(item.id) ? "✓" : "+"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const makeStyles = (t: ThemePalette) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: t.paper, paddingTop: 56, paddingHorizontal: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.paper },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 24, fontWeight: "700", color: t.ink },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 14 },
  dailyReviewLink: { color: t.accent, fontSize: 13, fontWeight: "600" },
  logout: { color: t.inkMuted, fontSize: 13 },
  saveRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 6,
    padding: 10,
    backgroundColor: t.surface,
    fontSize: 14,
      color: t.ink,
  },
  saveButton: { backgroundColor: t.accent, borderRadius: 6, paddingHorizontal: 16, justifyContent: "center" },
  saveButtonText: { color: t.accentContrast, fontWeight: "600", fontSize: 14 },
  uploadRow: { marginBottom: 8 },
  uploadText: { color: t.accent, fontSize: 12, fontWeight: "600" },
  navRow: { flexDirection: "row", flexWrap: "wrap", gap: 18, marginBottom: 12 },
  navLink: { color: t.inkMuted, fontSize: 13, fontWeight: "600" },
  search: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 6,
    padding: 10,
    backgroundColor: t.surface,
    fontSize: 14,
    marginBottom: 8,
      color: t.ink,
  },
  error: { color: t.danger, fontSize: 12, marginBottom: 8 },
  chipRow: { marginBottom: 12, flexGrow: 0 },
  chip: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: t.surface,
  },
  chipActive: { borderColor: t.accent, backgroundColor: t.accentSoft },
  chipText: { fontSize: 13, color: t.inkMuted },
  chipTextActive: { color: t.accent, fontWeight: "600" },
  newCollectionInput: {
    borderWidth: 1,
    borderColor: t.accent,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: t.surface,
    fontSize: 13,
    minWidth: 140,
      color: t.ink,
  },
  empty: { textAlign: "center", color: t.inkMuted, marginTop: 40 },
  hint: { fontSize: 11, color: t.inkMuted, marginBottom: 10 },
  card: { backgroundColor: t.surface, borderRadius: 8, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: t.border },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: "600", color: t.ink, marginBottom: 4 },
  cardMeta: { fontSize: 12, color: t.inkMuted },
  iconButton: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  starActive: { fontSize: 18, color: t.accent },
  starInactive: { fontSize: 18, color: t.inkFaint },
  deleteGlyph: { fontSize: 15 },
  memberButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.border,
    alignItems: "center",
    justifyContent: "center",
  },
  memberButtonActive: { backgroundColor: t.accent, borderColor: t.accent },
  memberButtonText: { fontSize: 14, color: t.inkMuted, fontWeight: "600" },
  memberButtonTextActive: { color: t.accentContrast },
});
