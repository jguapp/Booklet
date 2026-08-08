import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { Article } from "@booklet/shared";
import { emptyTrash, loadTrash, permanentlyDeleteArticle, restoreArticle } from "../lib/data/articles";

interface TrashScreenProps {
  authenticated: boolean;
  onBack: () => void;
}

export function TrashScreen({ authenticated, onBack }: TrashScreenProps) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Destructive actions arm on the first tap and fire on the second, rather
  // than using Alert.alert -- which is a no-op on react-native-web, the one
  // target this app can actually run on today (see LibraryScreen). `null`
  // when nothing is armed; an article id, or the sentinel "ALL", when it is.
  const [confirming, setConfirming] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setArticles(await loadTrash(authenticated));
      setError(null);
    } catch {
      setError("Couldn't load your trash. Pull down to retry.");
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

  async function handleRestore(article: Article) {
    setConfirming(null);
    setArticles((prev) => prev.filter((a) => a.id !== article.id));
    setError(null);
    try {
      await restoreArticle(article, authenticated);
    } catch {
      // Put it back in the trash list so the failure is visible, not silent.
      setArticles((prev) => [article, ...prev]);
      setError("Couldn't restore that. Try again.");
    }
  }

  async function handleDeleteForever(article: Article) {
    setConfirming(null);
    setArticles((prev) => prev.filter((a) => a.id !== article.id));
    setError(null);
    try {
      await permanentlyDeleteArticle(article.id, authenticated);
    } catch {
      setArticles((prev) => [article, ...prev]);
      setError("Couldn't delete that. Try again.");
    }
  }

  async function handleEmptyTrash() {
    setConfirming(null);
    const previous = articles;
    setArticles([]);
    setError(null);
    try {
      await emptyTrash(authenticated);
    } catch {
      setArticles(previous);
      setError("Couldn't empty the trash. Try again.");
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onBack}>
        <Text style={styles.back}>← Library</Text>
      </TouchableOpacity>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Trash</Text>
        {articles.length > 0 && (
          <TouchableOpacity onPress={() => (confirming === "ALL" ? handleEmptyTrash() : setConfirming("ALL"))}>
            <Text style={styles.emptyLink}>{confirming === "ALL" ? "Tap to confirm" : "Empty trash"}</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.subtitle}>Deleted articles are kept for 30 days.</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        data={articles}
        keyExtractor={(item) => item.id}
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
        ListEmptyComponent={<Text style={styles.empty}>Trash is empty.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.title ?? "Untitled"}</Text>
            <Text style={styles.cardMeta}>{item.siteName ?? item.author ?? item.sourceType}</Text>
            <View style={styles.actionsRow}>
              <TouchableOpacity style={styles.restoreButton} onPress={() => handleRestore(item)}>
                <Text style={styles.restoreButtonText}>Restore</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => (confirming === item.id ? handleDeleteForever(item) : setConfirming(item.id))}
              >
                <Text style={styles.deleteButtonText}>{confirming === item.id ? "Tap to confirm" : "Delete forever"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f7f4ee", paddingTop: 56, paddingHorizontal: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f7f4ee" },
  back: { color: "#b5502f", fontSize: 14, fontWeight: "600", marginBottom: 12 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 24, fontWeight: "700", color: "#1c1a16" },
  emptyLink: { color: "#b5502f", fontSize: 13, fontWeight: "600" },
  subtitle: { fontSize: 12, color: "#6b6558", marginTop: 4, marginBottom: 16 },
  error: { color: "#b5502f", fontSize: 12, marginBottom: 8 },
  empty: { textAlign: "center", color: "#6b6558", marginTop: 40 },
  card: { backgroundColor: "#fff", borderRadius: 8, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#ece6d8" },
  cardTitle: { fontSize: 16, fontWeight: "600", color: "#1c1a16", marginBottom: 4 },
  cardMeta: { fontSize: 12, color: "#6b6558", marginBottom: 10 },
  actionsRow: { flexDirection: "row", gap: 8 },
  restoreButton: { borderWidth: 1, borderColor: "#ddd6c7", borderRadius: 6, paddingVertical: 6, paddingHorizontal: 14 },
  restoreButtonText: { fontSize: 13, fontWeight: "600", color: "#1c1a16" },
  deleteButton: { borderWidth: 1, borderColor: "#e2b8ab", borderRadius: 6, paddingVertical: 6, paddingHorizontal: 14 },
  deleteButtonText: { fontSize: 13, fontWeight: "600", color: "#b5502f" },
});
