import { useCallback, useEffect, useState, useMemo } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { Feed, FeedItem } from "@booklet/shared";
import { ApiError, loadFeedItems, loadFeeds, subscribeFeed, unsubscribeFeed } from "../lib/data/feeds";
import { saveArticleFromUrl } from "../lib/data/articles";
import { useTheme, type ThemePalette } from "../lib/theme";

interface RssScreenProps {
  authenticated: boolean;
  onBack: () => void;
}

interface ItemsState {
  items: FeedItem[] | null; // null while loading
  error: string | null;
}

// Mirrors the web /rss page: subscribe by URL, each subscription lists its
// live-fetched current items with a per-item Save (into the library via the
// same saveArticleFromUrl path a hand-pasted URL takes). Items are never
// stored -- see data/feeds.ts.
export function RssScreen({ authenticated, onBack }: RssScreenProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [subscribing, setSubscribing] = useState(false);
  const [itemsByFeed, setItemsByFeed] = useState<Record<string, ItemsState>>({});
  const [savingLinks, setSavingLinks] = useState<Set<string>>(new Set());
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  // Two-tap unsubscribe, same convention as Trash -- Alert.alert is a no-op
  // on react-native-web.
  const [confirmingUnsub, setConfirmingUnsub] = useState<string | null>(null);

  const loadItemsFor = useCallback(
    (feed: Feed) => {
      setItemsByFeed((prev) => ({ ...prev, [feed.id]: { items: null, error: null } }));
      loadFeedItems(feed, authenticated)
        .then((fetched) => {
          setItemsByFeed((prev) => ({ ...prev, [feed.id]: { items: fetched.items, error: null } }));
        })
        .catch((err) => {
          const message = err instanceof ApiError ? err.message : "Couldn't fetch this feed.";
          setItemsByFeed((prev) => ({ ...prev, [feed.id]: { items: null, error: message } }));
        });
    },
    [authenticated],
  );

  const refresh = useCallback(async () => {
    try {
      const loaded = await loadFeeds(authenticated);
      setFeeds(loaded);
      setError(null);
      loaded.forEach(loadItemsFor);
    } catch {
      setError("Couldn't load your feeds. Pull down to retry.");
    }
  }, [authenticated, loadItemsFor]);

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

  async function handleSubscribe() {
    const trimmed = url.trim();
    if (!trimmed || subscribing) return;
    setSubscribing(true);
    setError(null);
    try {
      const feed = await subscribeFeed(trimmed, authenticated);
      setFeeds((prev) => [feed, ...prev]);
      setUrl("");
      loadItemsFor(feed);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't subscribe to that feed.");
    } finally {
      setSubscribing(false);
    }
  }

  async function handleUnsubscribe(feed: Feed) {
    setConfirmingUnsub(null);
    setFeeds((prev) => prev.filter((f) => f.id !== feed.id));
    setError(null);
    try {
      await unsubscribeFeed(feed.id, authenticated);
    } catch {
      setFeeds((prev) => [feed, ...prev]);
      setError("Couldn't unsubscribe. Try again.");
    }
  }

  async function handleSaveItem(item: FeedItem) {
    if (!item.link) return;
    const link = item.link;
    setSavingLinks((prev) => new Set(prev).add(link));
    setSavedNotice(null);
    try {
      await saveArticleFromUrl(link, authenticated);
      setSavedNotice(`Saved "${item.title ?? link}".`);
    } catch (err) {
      setSavedNotice(
        err instanceof ApiError && err.status === 409 ? "Already saved." : "Couldn't save that article.",
      );
    } finally {
      setSavingLinks((prev) => {
        const next = new Set(prev);
        next.delete(link);
        return next;
      });
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
      <Text style={styles.title}>RSS</Text>

      <View style={styles.subscribeRow}>
        <TextInput
          style={styles.input}
          placeholderTextColor={palette.inkFaint}
          placeholder="https://example.com/feed.xml"
          autoCapitalize="none"
          autoCorrect={false}
          value={url}
          onChangeText={setUrl}
          editable={!subscribing}
        />
        <TouchableOpacity style={styles.subscribeButton} onPress={handleSubscribe} disabled={subscribing}>
          {subscribing ? (
            <ActivityIndicator color={palette.accentContrast} size="small" />
          ) : (
            <Text style={styles.subscribeButtonText}>Subscribe</Text>
          )}
        </TouchableOpacity>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      {savedNotice && <Text style={styles.notice}>{savedNotice}</Text>}

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
        {feeds.length === 0 ? (
          <Text style={styles.empty}>No feeds yet -- subscribe to an RSS or Atom feed URL above.</Text>
        ) : (
          feeds.map((feed) => {
            const state = itemsByFeed[feed.id];
            return (
              <View key={feed.id} style={styles.feedSection}>
                <View style={styles.feedHeader}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.feedTitle} numberOfLines={1}>
                      {feed.title ?? feed.url}
                    </Text>
                    <Text style={styles.feedUrl} numberOfLines={1}>
                      {feed.url}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => (confirmingUnsub === feed.id ? handleUnsubscribe(feed) : setConfirmingUnsub(feed.id))}
                  >
                    <Text style={styles.unsubscribe}>
                      {confirmingUnsub === feed.id ? "Tap to confirm" : "Unsubscribe"}
                    </Text>
                  </TouchableOpacity>
                </View>

                {!state || state.items === null ? (
                  <Text style={styles.feedStatus}>{state?.error ?? "Loading…"}</Text>
                ) : state.items.length === 0 ? (
                  <Text style={styles.feedStatus}>No items in this feed.</Text>
                ) : (
                  state.items.map((item, i) => (
                    <View key={item.link ?? i} style={styles.itemCard}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.itemTitle}>{item.title ?? "Untitled"}</Text>
                        {item.summary && (
                          <Text style={styles.itemSummary} numberOfLines={2}>
                            {item.summary}
                          </Text>
                        )}
                      </View>
                      {item.link && (
                        <TouchableOpacity
                          style={styles.saveButton}
                          onPress={() => handleSaveItem(item)}
                          disabled={savingLinks.has(item.link)}
                        >
                          <Text style={styles.saveButtonText}>{savingLinks.has(item.link) ? "…" : "Save"}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))
                )}
              </View>
            );
          })
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
  title: { fontSize: 24, fontWeight: "700", color: t.ink, marginBottom: 16 },
  subscribeRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
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
  subscribeButton: { backgroundColor: t.accent, borderRadius: 6, paddingHorizontal: 14, justifyContent: "center" },
  subscribeButtonText: { color: t.accentContrast, fontWeight: "600", fontSize: 14 },
  error: { color: t.danger, fontSize: 12, marginBottom: 8 },
  notice: { color: t.accent, fontSize: 12, marginBottom: 8 },
  scrollContent: { paddingBottom: 32 },
  empty: { textAlign: "center", color: t.inkMuted, marginTop: 40 },
  feedSection: { marginBottom: 24 },
  feedHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  feedTitle: { fontSize: 17, fontWeight: "700", color: t.ink },
  feedUrl: { fontSize: 11, color: t.inkFaint },
  unsubscribe: { fontSize: 12, fontWeight: "600", color: t.danger },
  feedStatus: { fontSize: 13, color: t.inkMuted },
  itemCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: t.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.border,
    padding: 12,
    marginBottom: 8,
  },
  itemTitle: { fontSize: 15, fontWeight: "600", color: t.ink },
  itemSummary: { fontSize: 12, color: t.inkMuted, marginTop: 3 },
  saveButton: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  saveButtonText: { fontSize: 13, fontWeight: "600", color: t.ink },
});
