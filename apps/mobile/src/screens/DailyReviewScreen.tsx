import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { Article, Highlight, ResurfaceCandidate, ResurfaceFeedback } from "@booklet/shared";
import { applySm2Review, feedbackToQuality, selectHighlightsToResurface } from "@booklet/shared";
import { loadArticles } from "../lib/data/articles";
import { loadCurrentDigest } from "../lib/data/digests";
import { loadHighlights, updateHighlightFeedback } from "../lib/data/highlights";
import { useTheme, type ThemePalette } from "../lib/theme";

interface DailyReviewScreenProps {
  authenticated: boolean;
  onBack: () => void;
}

// Fixed rather than reading the user's resurfaceFrequency/highlightsPerDigest
// settings -- mobile has no Settings screen yet, so there's nothing to read.
const LOCAL_HIGHLIGHTS_PER_DIGEST = 5;

export function DailyReviewScreen({ authenticated, onBack }: DailyReviewScreenProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [loading, setLoading] = useState(true);
  const [articles, setArticles] = useState<Article[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [batchIds, setBatchIds] = useState<string[] | null>(null);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  // Prompted highlights (#157) keep their passage hidden until asked for,
  // so the grade below is a retrieval judgment rather than a re-read. Keyed
  // by id, not one flag: a single flag would reveal the next card's answer
  // before its question had been asked.
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const loadedArticles = await loadArticles(authenticated);
    setArticles(loadedArticles);

    if (authenticated) {
      // Server picks and persists the batch, so reopening this screen (or a
      // second device) sees the same highlights, not a freshly re-rolled set.
      const digest = await loadCurrentDigest();
      const batchHighlights = digest.highlights ?? [];
      setHighlights(batchHighlights);
      setBatchIds(batchHighlights.map((h) => h.id));
      return;
    }

    const loadedHighlights = await loadHighlights(undefined, false);
    setHighlights(loadedHighlights);
    const candidates: ResurfaceCandidate[] = loadedHighlights.map((h) => ({
      id: h.id,
      nextDueAt: h.nextDueAt,
      resurfaceArchivedAt: h.resurfaceArchivedAt,
    }));
    const selected = selectHighlightsToResurface(candidates, LOCAL_HIGHLIGHTS_PER_DIGEST);
    setBatchIds(selected.map((c) => c.id));
  }, [authenticated]);

  useEffect(() => {
    let cancelled = false;
    refresh()
      .catch(() => {
        // A rejection here used to be unhandled, and left batchIds at null --
        // which renders no cards, no "nothing eligible" box and no "done for
        // today" box, because all three are gated on batchIds. The screen
        // just sat there blank, permanently, whether the API was down or the
        // session had expired.
        if (!cancelled) setError("Couldn't load your review. Check your connection and try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const articleById = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);
  const batch = useMemo(() => {
    if (!batchIds) return [];
    const ids = new Set(batchIds);
    return highlights.filter((h) => ids.has(h.id) && !reviewedIds.has(h.id));
  }, [highlights, batchIds, reviewedIds]);

  async function applyFeedback(highlightId: string, feedback: ResurfaceFeedback | null, archive: boolean) {
    const target = highlights.find((h) => h.id === highlightId);
    if (!target) return;
    const now = new Date();
    const nowIso = now.toISOString();

    const sm2 = feedback
      ? applySm2Review(
          { easinessFactor: target.easinessFactor, intervalDays: target.intervalDays, repetitions: target.repetitions },
          feedbackToQuality(feedback),
          now,
        )
      : null;

    setError(null);
    let updated: Highlight;
    try {
      updated = await updateHighlightFeedback(
        target,
        {
          lastSurfacedAt: nowIso,
          surfaceCount: target.surfaceCount + 1,
          ...(feedback ? { lastFeedback: feedback, lastFeedbackAt: nowIso } : {}),
          ...(archive ? { resurfaceArchivedAt: nowIso } : {}),
          ...(sm2
            ? {
                easinessFactor: sm2.easinessFactor,
                intervalDays: sm2.intervalDays,
                repetitions: sm2.repetitions,
                nextDueAt: sm2.nextDueAt,
              }
            : {}),
        },
        authenticated,
      );
    } catch {
      // The card stays on screen and un-reviewed, which is the truth: nothing
      // was written. Before this the rejection was unhandled and the button
      // simply did nothing, so the obvious response -- tap it again -- would
      // have double-counted the review the moment the network came back.
      setError("Couldn't save that. Check your connection and try again.");
      return;
    }
    setHighlights((prev) => prev.map((h) => (h.id === highlightId ? updated : h)));
    setReviewedIds((prev) => new Set(prev).add(highlightId));
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const isDone = batchIds !== null && batch.length === 0;

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onBack}>
        <Text style={styles.back}>← Library</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Daily Review</Text>
      <Text style={styles.subtitle}>
        {batchIds ? `${batchIds.length} highlight${batchIds.length === 1 ? "" : "s"} selected for today.` : ""}
      </Text>

      {error && <Text style={styles.error}>{error}</Text>}

      {batchIds && batchIds.length === 0 && (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>No highlights are eligible to resurface right now.</Text>
        </View>
      )}
      {isDone && batchIds!.length > 0 && (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>That&apos;s everything for today. Nicely done.</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {batch.map((h) => {
          const concealed = !!h.prompt && !revealedIds.has(h.id);
          return (
            <View key={h.id} style={styles.card}>
              {h.prompt ? <Text style={concealed ? styles.quote : styles.prompt}>{h.prompt}</Text> : null}
              {concealed ? null : <Text style={styles.quote}>&ldquo;{h.selectedText}&rdquo;</Text>}
              <Text style={styles.articleTitle}>{articleById.get(h.articleId)?.title ?? "Untitled"}</Text>
              {concealed ? (
                // Grading is withheld until the answer has been asked for,
                // matching the web app. Archive stays available: deciding
                // you're done with a highlight isn't a recall judgment.
                <View style={styles.actionsRow}>
                  <TouchableOpacity style={styles.secondaryButton} onPress={() => applyFeedback(h.id, null, true)}>
                    <Text style={styles.secondaryButtonText}>Archive</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={() => setRevealedIds((prev) => new Set(prev).add(h.id))}
                  >
                    <Text style={styles.primaryButtonText}>Show the highlight</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.actionsRow}>
                  <TouchableOpacity style={styles.secondaryButton} onPress={() => applyFeedback(h.id, "FORGOT", false)}>
                    <Text style={styles.secondaryButtonText}>Forgot</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondaryButton} onPress={() => applyFeedback(h.id, null, true)}>
                    <Text style={styles.secondaryButtonText}>Archive</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={() => applyFeedback(h.id, "REMEMBERED", false)}
                  >
                    <Text style={styles.primaryButtonText}>Remembered</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemePalette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.paper, paddingTop: 56, paddingHorizontal: 16 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.paper },
    back: { color: t.accent, fontSize: 14, fontWeight: "600", marginBottom: 12 },
    title: { fontSize: 24, fontWeight: "700", color: t.ink, marginBottom: 4 },
    subtitle: { fontSize: 13, color: t.inkMuted, marginBottom: 20 },
    error: { color: t.danger, fontSize: 13, marginBottom: 12 },
    emptyBox: { borderWidth: 1, borderStyle: "dashed", borderColor: t.border, borderRadius: 8, padding: 24, alignItems: "center" },
    emptyText: { fontSize: 14, color: t.inkMuted, textAlign: "center" },
    card: { backgroundColor: t.surface, borderRadius: 8, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: t.border },
    quote: { fontSize: 16, color: t.ink, lineHeight: 22, marginBottom: 8 },
    // Once revealed, the prompt stays on the card above the passage, smaller
    // and quieter -- it's the context for the answer, not the answer.
    prompt: { fontSize: 14, fontWeight: "600", color: t.inkMuted, lineHeight: 20, marginBottom: 6 },
    articleTitle: { fontSize: 12, color: t.inkMuted, marginBottom: 12 },
    actionsRow: { flexDirection: "row", gap: 8 },
    secondaryButton: { flex: 1, borderWidth: 1, borderColor: t.border, borderRadius: 6, paddingVertical: 8, alignItems: "center" },
    secondaryButtonText: { fontSize: 12, fontWeight: "600", color: t.inkMuted },
    primaryButton: { flex: 1, backgroundColor: t.accent, borderRadius: 6, paddingVertical: 8, alignItems: "center" },
    primaryButtonText: { fontSize: 12, fontWeight: "600", color: t.accentContrast },
  });
