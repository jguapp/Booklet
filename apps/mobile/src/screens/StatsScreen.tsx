import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { Article, ReadingActivityDay, SourceType } from "@booklet/shared";
import { computeReadingStats } from "@booklet/shared";
import { loadArticles } from "../lib/data/articles";
import { loadReadingActivity } from "../lib/data/reading-activity";
import { formatDuration } from "../lib/format";
import { useTheme, type ThemePalette } from "../lib/theme";

interface StatsScreenProps {
  authenticated: boolean;
  onBack: () => void;
  onOpenRecap: () => void;
}

// Ported from the web stats page. Same window as /api/stats/reading-activity
// returns, so both data sources lay out into the same size grid.
const HEATMAP_WEEKS = 53;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Web's ladder is bg-accent at 30/55/80/100% opacity; RN supports 8-digit
// hex, so the same ladder is the theme's accent with an alpha suffix over
// surface2 as the zero level. Built per-palette in the component.
function heatColors(t: ThemePalette): string[] {
  return [t.surface2, `${t.accent}4D`, `${t.accent}8C`, `${t.accent}CC`, t.accent];
}

/** Real per-day reading time -- level buckets are minutes read. */
function levelFromMinutes(minutes: number): number {
  if (minutes <= 0) return 0;
  if (minutes < 10) return 1;
  if (minutes < 25) return 2;
  if (minutes < 45) return 3;
  return 4;
}

/** Articles *finished* that day -- the only signal without a signed-in
 * account's server-tracked history. Undercounts (a day spent partway
 * through an article shows blank) but beats an empty heatmap. */
function levelFromFinishedCount(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count <= 4) return 3;
  return 4;
}

/** Last HEATMAP_WEEKS*7 days as level numbers, oldest first, chunked into
 * 7-day week columns. Same logic as the web page's computeDailyActivity,
 * minus tooltips -- RN has no hover, and a tap target 11px square isn't
 * one. */
function computeWeeks(articles: Article[], activity: ReadingActivityDay[] | null): number[][] {
  const minutesByDay = new Map<string, number>();
  const finishedByDay = new Map<string, number>();
  if (activity) {
    for (const a of activity) minutesByDay.set(a.date, a.seconds / 60);
  } else {
    for (const a of articles) {
      if (!a.archivedAt) continue;
      const key = dayKey(new Date(a.archivedAt));
      finishedByDay.set(key, (finishedByDay.get(key) ?? 0) + 1);
    }
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - end.getDay()));
  const totalDays = HEATMAP_WEEKS * 7;
  const start = new Date(end);
  start.setDate(start.getDate() - totalDays + 1);

  const levels: number[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    if (d > today) {
      levels.push(0);
    } else if (activity) {
      levels.push(levelFromMinutes(minutesByDay.get(dayKey(d)) ?? 0));
    } else {
      levels.push(levelFromFinishedCount(finishedByDay.get(dayKey(d)) ?? 0));
    }
  }

  const weeks: number[][] = [];
  for (let i = 0; i < levels.length; i += 7) weeks.push(levels.slice(i, i + 7));
  return weeks;
}

// Styles come in as a prop -- they're built per-theme inside the screen
// (makeStyles below), so module scope has no `styles` to close over.
type Styles = ReturnType<typeof makeStyles>;

function StatCard({ label, value, styles }: { label: string; value: string; styles: Styles }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Bar({ fraction, styles }: { fraction: number; styles: Styles }) {
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${Math.round(fraction * 100)}%` }]} />
    </View>
  );
}

export function StatsScreen({ authenticated, onBack, onOpenRecap }: StatsScreenProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [activity, setActivity] = useState<ReadingActivityDay[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heatmapRef = useRef<ScrollView>(null);

  const refresh = useCallback(async () => {
    try {
      setArticles(await loadArticles(authenticated));
      setError(null);
    } catch {
      setError("Couldn't load your stats. Pull down to retry.");
    }
    // Degrades rather than blocks, same as web: the heatmap already treats
    // null as "no server history" (anonymous mode is that case every time).
    try {
      setActivity((await loadReadingActivity(authenticated))?.days ?? null);
    } catch {
      setActivity(null);
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

  const stats = useMemo(() => computeReadingStats(articles), [articles]);
  const weeks = useMemo(() => computeWeeks(articles, activity), [articles, activity]);
  const heat = useMemo(() => heatColors(palette), [palette]);

  const topTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of articles) for (const tag of a.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [articles]);

  const sourceCounts = useMemo(() => {
    const c: Record<SourceType, number> = { HTML: 0, PDF: 0, EPUB: 0, BOOK: 0 };
    for (const a of articles) c[a.sourceType]++;
    return c;
  }, [articles]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const avgSecondsPerFinished = stats.finishedArticles > 0 ? stats.totalReadingSeconds / stats.finishedArticles : 0;
  const sourceTotal = articles.length || 1;
  const sourceEntries = (["HTML", "PDF", "EPUB", "BOOK"] as SourceType[]).filter((t) => sourceCounts[t] > 0);
  const maxTagCount = topTags[0]?.[1] ?? 1;

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onBack}>
        <Text style={styles.back}>← Library</Text>
      </TouchableOpacity>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Stats</Text>
        <TouchableOpacity onPress={onOpenRecap}>
          <Text style={styles.recapLink}>Your Recap →</Text>
        </TouchableOpacity>
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
        contentContainerStyle={styles.scrollContent}
      >
        {stats.totalArticles === 0 ? (
          <Text style={styles.empty}>Nothing saved yet -- stats show up once you start reading.</Text>
        ) : (
          <>
            <View style={styles.cardsGrid}>
              <StatCard styles={styles} label="Day streak" value={String(stats.currentStreakDays)} />
              <StatCard styles={styles} label="Longest streak" value={String(stats.longestStreakDays)} />
              <StatCard styles={styles} label="Time spent" value={formatDuration(stats.totalReadingSeconds)} />
              <StatCard styles={styles} label="Completion" value={`${Math.round(stats.completionRate * 100)}%`} />
              <StatCard styles={styles} label="Finished" value={`${stats.finishedArticles} / ${stats.totalArticles}`} />
              <StatCard
                styles={styles}
                label="Avg. per article"
                value={avgSecondsPerFinished > 0 ? formatDuration(avgSecondsPerFinished) : "--"}
              />
            </View>

            <Text style={styles.sectionHeading}>Days read, past year</Text>
            <View style={styles.panel}>
              {/* Newest weeks are what you came to look at -- scroll starts
                  pinned to the right end, where "now" is. */}
              <ScrollView
                ref={heatmapRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                onContentSizeChange={() => heatmapRef.current?.scrollToEnd({ animated: false })}
              >
                <View style={styles.heatmapRow}>
                  {weeks.map((week, i) => (
                    <View key={i} style={styles.heatmapCol}>
                      {week.map((level, j) => (
                        <View key={j} style={[styles.heatCell, { backgroundColor: heat[level] }]} />
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>

            <Text style={styles.sectionHeading}>Top tags</Text>
            <View style={styles.panel}>
              {topTags.length === 0 ? (
                <Text style={styles.panelEmpty}>No tags yet.</Text>
              ) : (
                topTags.map(([tag, count]) => (
                  <View key={tag} style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel} numberOfLines={1}>
                      {tag}
                    </Text>
                    <Bar styles={styles} fraction={count / maxTagCount} />
                    <Text style={styles.breakdownCount}>{count}</Text>
                  </View>
                ))
              )}
            </View>

            <Text style={styles.sectionHeading}>By source</Text>
            <View style={styles.panel}>
              {sourceEntries.map((type) => (
                <View key={type} style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>{type}</Text>
                  <Bar styles={styles} fraction={sourceCounts[type] / sourceTotal} />
                  <Text style={styles.breakdownCount}>{sourceCounts[type]}</Text>
                </View>
              ))}
            </View>
          </>
        )}
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
  recapLink: { color: t.accent, fontSize: 13, fontWeight: "600" },
  error: { color: t.danger, fontSize: 12, marginBottom: 8 },
  scrollContent: { paddingBottom: 32 },
  empty: { textAlign: "center", color: t.inkMuted, marginTop: 40 },
  cardsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  statCard: {
    flexBasis: "31%",
    flexGrow: 1,
    backgroundColor: t.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.border,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  statValue: { fontSize: 20, fontWeight: "700", color: t.ink },
  statLabel: { fontSize: 10, color: t.inkMuted, marginTop: 3, textTransform: "uppercase", letterSpacing: 0.5 },
  sectionHeading: {
    fontSize: 11,
    fontWeight: "600",
    color: t.inkMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  panel: {
    backgroundColor: t.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.border,
    padding: 14,
    marginBottom: 20,
  },
  panelEmpty: { fontSize: 13, color: t.inkMuted },
  heatmapRow: { flexDirection: "row", gap: 3 },
  heatmapCol: { flexDirection: "column", gap: 3 },
  heatCell: { width: 11, height: 11, borderRadius: 2 },
  breakdownRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  breakdownLabel: { width: 80, fontSize: 13, color: t.ink },
  breakdownCount: { width: 24, textAlign: "right", fontSize: 12, color: t.inkMuted },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: t.surface2, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 4, backgroundColor: t.accent },
});
