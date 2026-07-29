import { useCallback, useEffect, useRef, useState } from "react";
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
import { ApiError, loadArticles, saveArticleFromFile, saveArticleFromUrl } from "../lib/data/articles";
import {
  addArticleToCollection,
  createCollection,
  loadArticleIdsInCollection,
  loadCollections,
  removeArticleFromCollection,
} from "../lib/data/collections";

interface LibraryScreenProps {
  authenticated: boolean;
  onOpenArticle: (id: string) => void;
  onOpenDailyReview: () => void;
  onSignedOut: () => void;
}

export function LibraryScreen({ authenticated, onOpenArticle, onOpenDailyReview, onSignedOut }: LibraryScreenProps) {
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

  const refresh = useCallback(async () => {
    try {
      const [loadedArticles, loadedCollections] = await Promise.all([
        loadArticles(authenticated),
        loadCollections(authenticated),
      ]);
      setArticles(loadedArticles);
      setCollections(loadedCollections);
    } catch {
      // best-effort -- keep whatever was already loaded
    }
  }, [authenticated]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
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
    loadArticleIdsInCollection(activeCollectionId, authenticated).then((ids) => {
      if (!cancelled) setCollectionMemberIds(ids);
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
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "application/epub+zip"],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];

    setSaving(true);
    setError(null);
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
    setCollectionMemberIds((prev) => {
      const next = new Set(prev);
      if (isMember) next.delete(articleId);
      else next.add(articleId);
      return next;
    });
    if (isMember) await removeArticleFromCollection(articleId, activeCollectionId, authenticated);
    else await addArticleToCollection(articleId, activeCollectionId, authenticated);
  }

  async function handleAccountAction() {
    if (authenticated) await clearSession();
    onSignedOut();
  }

  // Selecting a collection shows every article (not just members) with a
  // +/checkmark toggle -- filtering down to members-only would hide exactly
  // the non-member articles the toggle exists to add, since a hidden card's
  // button can never be tapped. Membership is still visually obvious (✓ vs
  // +), so this doubles as "browse this collection"'s checked-off view.
  const visibleArticles = articles;

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

      <View style={styles.saveRow}>
        <TextInput
          style={styles.input}
          placeholder="Paste a URL to save"
          autoCapitalize="none"
          value={url}
          onChangeText={setUrl}
        />
        <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveButtonText}>Save</Text>}
        </TouchableOpacity>
      </View>
      <TouchableOpacity onPress={handleUploadFile} disabled={saving} style={styles.uploadRow}>
        <Text style={styles.uploadText}>Or upload a PDF / EPUB</Text>
      </TouchableOpacity>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f7f4ee", paddingTop: 56, paddingHorizontal: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f7f4ee" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 24, fontWeight: "700", color: "#1c1a16" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 14 },
  dailyReviewLink: { color: "#1F6F6B", fontSize: 13, fontWeight: "600" },
  logout: { color: "#6b6558", fontSize: 13 },
  saveRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd6c7",
    borderRadius: 6,
    padding: 10,
    backgroundColor: "#fff",
    fontSize: 14,
  },
  saveButton: { backgroundColor: "#b5502f", borderRadius: 6, paddingHorizontal: 16, justifyContent: "center" },
  saveButtonText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  uploadRow: { marginBottom: 8 },
  uploadText: { color: "#b5502f", fontSize: 12, fontWeight: "600" },
  error: { color: "#b5502f", fontSize: 12, marginBottom: 8 },
  chipRow: { marginBottom: 12, flexGrow: 0 },
  chip: {
    borderWidth: 1,
    borderColor: "#ddd6c7",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#fff",
  },
  chipActive: { borderColor: "#b5502f", backgroundColor: "#fbe9e3" },
  chipText: { fontSize: 13, color: "#6b6558" },
  chipTextActive: { color: "#b5502f", fontWeight: "600" },
  newCollectionInput: {
    borderWidth: 1,
    borderColor: "#b5502f",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#fff",
    fontSize: 13,
    minWidth: 140,
  },
  empty: { textAlign: "center", color: "#6b6558", marginTop: 40 },
  hint: { fontSize: 11, color: "#6b6558", marginBottom: 10 },
  card: { backgroundColor: "#fff", borderRadius: 8, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#ece6d8" },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: "600", color: "#1c1a16", marginBottom: 4 },
  cardMeta: { fontSize: 12, color: "#6b6558" },
  memberButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#ddd6c7",
    alignItems: "center",
    justifyContent: "center",
  },
  memberButtonActive: { backgroundColor: "#b5502f", borderColor: "#b5502f" },
  memberButtonText: { fontSize: 14, color: "#6b6558", fontWeight: "600" },
  memberButtonTextActive: { color: "#fff" },
});
