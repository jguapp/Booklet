import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator, type NativeStackScreenProps } from "@react-navigation/native-stack";
import { ThemeProvider, useTheme } from "./src/lib/theme";
import { getSession } from "./src/lib/api";
import { migrateLocalDataToAccount, PartialMigrationError } from "./src/lib/data/sync";
import { LoginScreen } from "./src/screens/LoginScreen";
import { LibraryScreen } from "./src/screens/LibraryScreen";
import { ArticleScreen } from "./src/screens/ArticleScreen";
import { DailyReviewScreen } from "./src/screens/DailyReviewScreen";
import { FavoritesScreen } from "./src/screens/FavoritesScreen";
import { HighlightsScreen } from "./src/screens/HighlightsScreen";
import { StatsScreen } from "./src/screens/StatsScreen";
import { RecapScreen } from "./src/screens/RecapScreen";
import { RssScreen } from "./src/screens/RssScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { TrashScreen } from "./src/screens/TrashScreen";

// React Navigation replaced the hand-rolled Screen union once the app
// passed the "meaningfully more than a handful of screens" bar that
// union's comment set for itself (eleven screens). What it buys at this
// size: Android's hardware back button and iOS's edge-swipe both work
// without any code here, and screen state (a half-typed search, a scroll
// position) survives navigating away and back, which the
// render-one-screen union threw away by design.
//
// Two deliberate choices:
// - `headerShown: false` everywhere. Every screen already renders its own
//   back link and title, sized and themed to match the app; the native
//   header would duplicate both and un-theme the top of every screen.
// - `authenticated` still travels as a route param rather than moving to a
//   global flag, exactly as the union carried it -- the web app's
//   "every read/write takes the caller's auth state" pattern
//   (lib/data/articles.ts) survives the migration untouched.
export type RootStackParamList = {
  Login: undefined;
  Library: { authenticated: boolean };
  Article: { id: string; authenticated: boolean };
  DailyReview: { authenticated: boolean };
  Favorites: { authenticated: boolean };
  Highlights: { authenticated: boolean };
  Stats: { authenticated: boolean };
  Recap: { authenticated: boolean };
  Rss: { authenticated: boolean };
  Settings: { authenticated: boolean };
  Trash: { authenticated: boolean };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}

function AppInner() {
  const { theme, palette } = useTheme();
  const [checkingSession, setCheckingSession] = useState(true);
  const [restoredAuthenticated, setRestoredAuthenticated] = useState(false);
  const [migrationNotice, setMigrationNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      let authenticated = false;
      try {
        authenticated = (await getSession()) !== null;
      } catch {
        // getSession already swallows storage failures, so reaching this is
        // unexpected -- but the spinner below is the whole app until
        // checkingSession clears, and there is no screen to show an error on
        // yet. Falling through to the login screen is recoverable; leaving
        // the spinner up forever, which is what a rejection here used to do,
        // is not.
      }
      if (cancelled) return;
      setRestoredAuthenticated(authenticated);
      setCheckingSession(false);
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  if (checkingSession) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: palette.paper }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <>
      {/* "auto" tracks the OS scheme, which is wrong the moment the user
          picks a theme that disagrees with it (Night on a light-mode phone).
          Status bar glyphs are light-on-dark for Night, dark-on-light for
          the three paper-ish themes. */}
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      <NavigationContainer>
        <Stack.Navigator
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.paper } }}
          initialRouteName={restoredAuthenticated ? "Library" : "Login"}
        >
          <Stack.Screen name="Login">
            {({ navigation }: NativeStackScreenProps<RootStackParamList, "Login">) => (
              <LoginScreen
                onLoggedIn={async () => {
                  // Best-effort in the sense that a failure never blocks the
                  // login, same as the web app's runMigration -- but not
                  // silent. Whatever did not move is still on the device, and
                  // the signed-in library does not read local storage, so
                  // without a word here the user simply arrives at a library
                  // missing articles they saved. That is #164's symptom, and
                  // a swallowed error reproduces it exactly.
                  setMigrationNotice(null);
                  try {
                    await migrateLocalDataToAccount();
                  } catch (err) {
                    if (err instanceof PartialMigrationError) {
                      // How much landed, not just how much didn't -- a
                      // migration that moved 58 of 60 is a very different
                      // thing to tell someone than one that moved nothing,
                      // and both throw here.
                      const moved = err.progress.importedArticles + err.progress.skippedArticles;
                      setMigrationNotice(
                        `Moved ${moved} saved article(s) to your account; ${err.remainingArticles} couldn't be moved yet. Those are still on this device -- log out and back in to retry.`,
                      );
                    } else {
                      setMigrationNotice(
                        "Couldn't move this device's saved articles to your account. They're still here -- log out and back in to retry.",
                      );
                    }
                  }
                  // reset, not navigate: Login must not stay under the
                  // Library on the stack, or the first back gesture after
                  // signing in "logs out".
                  navigation.reset({ index: 0, routes: [{ name: "Library", params: { authenticated: true } }] });
                }}
                onContinueWithoutAccount={() =>
                  navigation.reset({ index: 0, routes: [{ name: "Library", params: { authenticated: false } }] })
                }
              />
            )}
          </Stack.Screen>

          <Stack.Screen name="Library" initialParams={{ authenticated: restoredAuthenticated }}>
            {({ navigation, route }: NativeStackScreenProps<RootStackParamList, "Library">) => {
              const { authenticated } = route.params;
              return (
                <LibraryScreen
                  authenticated={authenticated}
                  migrationNotice={migrationNotice}
                  onOpenArticle={(id) => navigation.navigate("Article", { id, authenticated })}
                  onOpenDailyReview={() => navigation.navigate("DailyReview", { authenticated })}
                  onOpenFavorites={() => navigation.navigate("Favorites", { authenticated })}
                  onOpenHighlights={() => navigation.navigate("Highlights", { authenticated })}
                  onOpenStats={() => navigation.navigate("Stats", { authenticated })}
                  onOpenRss={() => navigation.navigate("Rss", { authenticated })}
                  onOpenSettings={() => navigation.navigate("Settings", { authenticated })}
                  onOpenTrash={() => navigation.navigate("Trash", { authenticated })}
                  onSignedOut={() => {
                    setMigrationNotice(null);
                    navigation.reset({ index: 0, routes: [{ name: "Login" }] });
                  }}
                />
              );
            }}
          </Stack.Screen>

          <Stack.Screen name="Article">
            {({ navigation, route }: NativeStackScreenProps<RootStackParamList, "Article">) => (
              <ArticleScreen
                articleId={route.params.id}
                authenticated={route.params.authenticated}
                onBack={() => navigation.goBack()}
              />
            )}
          </Stack.Screen>

          <Stack.Screen name="DailyReview">
            {({ navigation, route }: NativeStackScreenProps<RootStackParamList, "DailyReview">) => (
              <DailyReviewScreen authenticated={route.params.authenticated} onBack={() => navigation.goBack()} />
            )}
          </Stack.Screen>

          <Stack.Screen name="Favorites">
            {({ navigation, route }: NativeStackScreenProps<RootStackParamList, "Favorites">) => (
              <FavoritesScreen
                authenticated={route.params.authenticated}
                onBack={() => navigation.goBack()}
                onOpenArticle={(id) => navigation.navigate("Article", { id, authenticated: route.params.authenticated })}
              />
            )}
          </Stack.Screen>

          <Stack.Screen name="Highlights">
            {({ navigation, route }: NativeStackScreenProps<RootStackParamList, "Highlights">) => (
              <HighlightsScreen
                authenticated={route.params.authenticated}
                onBack={() => navigation.goBack()}
                onOpenArticle={(id) => navigation.navigate("Article", { id, authenticated: route.params.authenticated })}
              />
            )}
          </Stack.Screen>

          <Stack.Screen name="Stats">
            {({ navigation, route }: NativeStackScreenProps<RootStackParamList, "Stats">) => (
              <StatsScreen
                authenticated={route.params.authenticated}
                onBack={() => navigation.goBack()}
                onOpenRecap={() => navigation.navigate("Recap", { authenticated: route.params.authenticated })}
              />
            )}
          </Stack.Screen>

          <Stack.Screen name="Recap">
            {({ navigation, route }: NativeStackScreenProps<RootStackParamList, "Recap">) => (
              <RecapScreen authenticated={route.params.authenticated} onBack={() => navigation.goBack()} />
            )}
          </Stack.Screen>

          <Stack.Screen name="Rss">
            {({ navigation, route }: NativeStackScreenProps<RootStackParamList, "Rss">) => (
              <RssScreen authenticated={route.params.authenticated} onBack={() => navigation.goBack()} />
            )}
          </Stack.Screen>

          <Stack.Screen name="Settings">
            {({ navigation, route }: NativeStackScreenProps<RootStackParamList, "Settings">) => (
              <SettingsScreen
                authenticated={route.params.authenticated}
                onBack={() => navigation.goBack()}
                onSignedOut={() => {
                  setMigrationNotice(null);
                  navigation.reset({ index: 0, routes: [{ name: "Login" }] });
                }}
              />
            )}
          </Stack.Screen>

          <Stack.Screen name="Trash">
            {({ navigation, route }: NativeStackScreenProps<RootStackParamList, "Trash">) => (
              <TrashScreen authenticated={route.params.authenticated} onBack={() => navigation.goBack()} />
            )}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
}
