import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { Article } from "@booklet/shared";
import { computeRecap, type RecapPeriod } from "@booklet/shared";
import { loadArticles } from "../lib/data/articles";
import { formatDuration } from "../lib/format";
import { useTheme, type ThemePalette } from "../lib/theme";

interface RecapScreenProps {
  authenticated: boolean;
  onBack: () => void;
}

// The web /recap page's time-boxed slice of the Stats data (computeRecap,
// packages/shared/recap.ts), minus "Copy summary" -- RN's Clipboard was
// deprecated out of core and the expo-clipboard package isn't a dependency
// this screen alone justifies adding.
const PERIODS: { value: RecapPeriod; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

// Styles come in as a prop -- they're built per-theme inside the screen.
type Styles = ReturnType<typeof makeStyles>;

function BigStat({ value, label, styles }: { value: string; label: string; styles: Styles }) {
  return (
    <View style={styles.bigStat}>
      <Text style={styles.bigStatValue}>{value}</Text>
      <Text style={styles.bigStatLabel}>{label}</Text>
    </View>
  );
}

export function RecapScreen({ authenticated, onBack }: RecapScreenProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<RecapPeriod>("week");

  const refresh = useCallback(async () => {
    try {
      setArticles(await loadArticles(authenticated));
      setError(null);
    } catch {
      setError("Couldn't load your recap. Pull down to retry.");
    }
  }, [authenticated]);

  // useFocusEffect, not a mount effect: React Navigation keeps stacked
  // screens mounted, so "the user came back here" no longer implies a
  // remount. Without this, an edit made on another screen (a rename in the
  // reader, a restore in Trash) never appeared until a manual
  // pull-to-refresh -- caught by the Playwright run when the migration
  // landed. `loading` starts true and is only ever cleared, so the spinner
  // covers the first load without flashing on every later refocus.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      refresh().finally(() => {
        if (!cancelled) setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }, [refresh]),
  );

  const recap = useMemo(() => computeRecap(articles, period), [articles, period]);

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
        <Text style={styles.back}>← Stats</Text>
      </TouchableOpacity>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Your Recap</Text>
        <View style={styles.periodToggle}>
          {PERIODS.map((p) => (
            <TouchableOpacity
              key={p.value}
              style={[styles.periodButton, period === p.value && styles.periodButtonActive]}
              onPress={() => setPeriod(p.value)}
            >
              <Text style={[styles.periodText, period === p.value && styles.periodTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}

      <ScrollView
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
      >
        <View style={styles.card}>
          <Text style={styles.cardHeading}>{period === "week" ? "This week" : "This month"} in Booklet</Text>
          <View style={styles.statsGrid}>
            <BigStat styles={styles} value={String(recap.articlesSaved)} label="Saved" />
            <BigStat styles={styles} value={String(recap.articlesFinished)} label="Finished" />
            <BigStat styles={styles} value={formatDuration(recap.timeSpentSeconds)} label="Time reading" />
            <BigStat styles={styles} value={String(recap.currentStreakDays)} label="Day streak" />
          </View>
          {recap.topTags.length > 0 && (
            <View style={styles.tagsRow}>
              {recap.topTags.map((t) => (
                <View key={t.tag} style={styles.tagChip}>
                  <Text style={styles.tagText}>{t.tag}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <Text style={styles.footnote}>
          Recap doesn&apos;t email itself to you yet -- for now, it&apos;s here whenever you want to check in.
        </Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemePalette) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: t.paper, paddingTop: 56, paddingHorizontal: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.paper },
  back: { color: t.accent, fontSize: 14, fontWeight: "600", marginBottom: 12 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 24, fontWeight: "700", color: t.ink },
  periodToggle: { flexDirection: "row", backgroundColor: t.surface2, borderRadius: 6, padding: 2 },
  periodButton: { borderRadius: 5, paddingHorizontal: 10, paddingVertical: 5 },
  periodButtonActive: { backgroundColor: t.accent },
  periodText: { fontSize: 12, fontWeight: "600", color: t.inkMuted },
  periodTextActive: { color: t.accentContrast },
  error: { color: t.danger, fontSize: 12, marginBottom: 8 },
  card: {
    backgroundColor: t.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.border,
    paddingVertical: 28,
    paddingHorizontal: 20,
  },
  cardHeading: { textAlign: "center", fontSize: 13, color: t.inkMuted, marginBottom: 24 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: 24 },
  bigStat: { width: "50%", alignItems: "center" },
  bigStatValue: { fontSize: 30, fontWeight: "700", color: t.ink },
  bigStatLabel: { fontSize: 10, color: t.inkMuted, marginTop: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, marginTop: 28 },
  tagChip: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: t.paper,
  },
  tagText: { fontSize: 12, color: t.inkMuted },
  footnote: { textAlign: "center", fontSize: 11, color: t.inkFaint, marginTop: 20 },
});
