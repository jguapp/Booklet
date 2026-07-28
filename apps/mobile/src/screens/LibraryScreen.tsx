import { useCallback, useEffect, useState } from "react";
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
import type { Article } from "@booklet/shared";
import { ApiError, clearSession, loadArticles, saveArticleFromUrl } from "../lib/api";

interface LibraryScreenProps {
  onOpenArticle: (id: string) => void;
  onLoggedOut: () => void;
}

export function LibraryScreen({ onOpenArticle, onLoggedOut }: LibraryScreenProps) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setArticles(await loadArticles());
    } catch {
      // best-effort -- keep whatever was already loaded
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function handleSave() {
    if (!url.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const article = await saveArticleFromUrl(url.trim());
      setArticles((prev) => [article, ...prev]);
      setUrl("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save that URL.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    await clearSession();
    onLoggedOut();
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
      <View style={styles.header}>
        <Text style={styles.title}>Library</Text>
        <TouchableOpacity onPress={handleLogout}>
          <Text style={styles.logout}>Log out</Text>
        </TouchableOpacity>
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
      {error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        data={articles}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => {
          setRefreshing(true);
          await refresh();
          setRefreshing(false);
        }} />}
        ListEmptyComponent={<Text style={styles.empty}>Nothing here yet.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => onOpenArticle(item.id)}>
            <Text style={styles.cardTitle}>{item.title ?? "Untitled"}</Text>
            <Text style={styles.cardMeta}>
              {item.siteName ?? item.author ?? item.sourceType} · {item.status}
            </Text>
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
  error: { color: "#b5502f", fontSize: 12, marginBottom: 8 },
  empty: { textAlign: "center", color: "#6b6558", marginTop: 40 },
  card: { backgroundColor: "#fff", borderRadius: 8, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#ece6d8" },
  cardTitle: { fontSize: 16, fontWeight: "600", color: "#1c1a16", marginBottom: 4 },
  cardMeta: { fontSize: 12, color: "#6b6558" },
});
