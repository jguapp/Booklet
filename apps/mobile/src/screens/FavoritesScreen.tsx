import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { Article } from "@booklet/shared";
import { loadArticles, updateArticleFavorited } from "../lib/data/articles";

interface FavoritesScreenProps {
  authenticated: boolean;
  onBack: () => void;
  onOpenArticle: (id: string) => void;
}

export function FavoritesScreen({ authenticated, onBack, onOpenArticle }: FavoritesScreenProps) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      // loadArticles already excludes trashed rows, so a favorited-then-
      // trashed article correctly drops out of here too -- matching the web
      // Favorites page, which filters the same list.
      setArticles(await loadArticles(authenticated));
      setError(null);
    } catch {
      setError("Couldn't load your favorites. Pull down to retry.");
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

  const favorites = useMemo(
    () =>
      articles
        .filter((a) => a.favorited)
        .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()),
    [articles],
  );

  async function handleUnfavorite(article: Article) {
    // Optimistic: drop it from the list now, put it back if the write fails.
    setArticles((prev) => prev.map((a) => (a.id === article.id ? { ...a, favorited: false } : a)));
    setError(null);
    try {
      await updateArticleFavorited(article, false, authenticated);
    } catch {
      setArticles((prev) => prev.map((a) => (a.id === article.id ? { ...a, favorited: true } : a)));
      setError("Couldn't update that. Try again.");
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
      <Text style={styles.title}>Favorites</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        data={favorites}
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
        ListEmptyComponent={<Text style={styles.empty}>No favorites yet. Tap the star on an article to add one.</Text>}
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
                style={styles.starButton}
                onPress={() => handleUnfavorite(item)}
                accessibilityLabel="Remove from favorites"
              >
                <Text style={styles.starActive}>★</Text>
              </TouchableOpacity>
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
  back: { color: "#b5502f", fontSize: 14, fontWeight: "600", marginBottom: 12 },
  title: { fontSize: 24, fontWeight: "700", color: "#1c1a16", marginBottom: 16 },
  error: { color: "#b5502f", fontSize: 12, marginBottom: 8 },
  empty: { textAlign: "center", color: "#6b6558", marginTop: 40 },
  card: { backgroundColor: "#fff", borderRadius: 8, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#ece6d8" },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: "600", color: "#1c1a16", marginBottom: 4 },
  cardMeta: { fontSize: 12, color: "#6b6558" },
  starButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  starActive: { fontSize: 20, color: "#b5502f" },
});
