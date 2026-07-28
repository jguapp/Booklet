import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { Article } from "@booklet/shared";
import { loadArticle } from "../lib/api";

interface ArticleScreenProps {
  articleId: string;
  onBack: () => void;
}

// Read-only for now -- no highlighting yet. The web app's highlighting is
// built on the browser's Selection/Range APIs (see lib/reader/dom-range.ts),
// which don't exist in React Native; a mobile equivalent needs its own
// text-selection approach, not a port of that code. Same principle as the
// browser extension: ship the useful slice first, not a stalled attempt at
// full parity.
export function ArticleScreen({ articleId, onBack }: ArticleScreenProps) {
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadArticle(articleId)
      .then(setArticle)
      .finally(() => setLoading(false));
  }, [articleId]);

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
        <Text>Couldn't load that article.</Text>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>Back to Library</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={onBack}>
        <Text style={styles.back}>← Library</Text>
      </TouchableOpacity>
      <Text style={styles.title}>{article.title ?? "Untitled"}</Text>
      <Text style={styles.meta}>{article.siteName ?? article.author ?? article.sourceType}</Text>
      <Text style={styles.body}>{article.extractedText ?? "No readable content for this article."}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f7f4ee" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#f7f4ee" },
  content: { padding: 20, paddingTop: 56 },
  back: { color: "#b5502f", fontSize: 14, marginBottom: 16, fontWeight: "600" },
  title: { fontSize: 24, fontWeight: "700", color: "#1c1a16", marginBottom: 4 },
  meta: { fontSize: 13, color: "#6b6558", marginBottom: 20 },
  body: { fontSize: 16, lineHeight: 26, color: "#1c1a16" },
});
