import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { getSession } from "./src/lib/api";
import { migrateLocalDataToAccount, PartialMigrationError } from "./src/lib/data/sync";
import { LoginScreen } from "./src/screens/LoginScreen";
import { LibraryScreen } from "./src/screens/LibraryScreen";
import { ArticleScreen } from "./src/screens/ArticleScreen";
import { DailyReviewScreen } from "./src/screens/DailyReviewScreen";
import { FavoritesScreen } from "./src/screens/FavoritesScreen";
import { TrashScreen } from "./src/screens/TrashScreen";

// No navigation library -- a handful of screens and a session check don't
// need React Navigation's setup (and its native-linking config) for a
// scaffold this size. `authenticated` travels with the library/article
// screens rather than living in one global flag, matching the web app's
// "every read/write goes through a repository that takes the caller's
// current auth state" pattern (lib/data/articles.ts) instead of a
// module-level branch.
type Screen =
  | { name: "login" }
  | { name: "library"; authenticated: boolean }
  | { name: "article"; id: string; authenticated: boolean }
  | { name: "resurface"; authenticated: boolean }
  | { name: "favorites"; authenticated: boolean }
  | { name: "trash"; authenticated: boolean };

export default function App() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [screen, setScreen] = useState<Screen>({ name: "login" });
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
      if (authenticated) setScreen({ name: "library", authenticated: true });
      setCheckingSession(false);
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  if (checkingSession) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="auto" />
      {screen.name === "login" && (
        <LoginScreen
          onLoggedIn={async () => {
            // Best-effort in the sense that a failure never blocks the login,
            // same as the web app's runMigration -- but not silent. Whatever
            // did not move is still on the device, and the signed-in library
            // does not read local storage, so without a word here the user
            // simply arrives at a library missing articles they saved. That
            // is #164's symptom, and a swallowed error reproduces it exactly.
            setMigrationNotice(null);
            try {
              await migrateLocalDataToAccount();
            } catch (err) {
              if (err instanceof PartialMigrationError) {
                // How much landed, not just how much didn't -- a migration
                // that moved 58 of 60 is a very different thing to tell
                // someone than one that moved nothing, and both throw here.
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
            setScreen({ name: "library", authenticated: true });
          }}
          onContinueWithoutAccount={() => setScreen({ name: "library", authenticated: false })}
        />
      )}
      {screen.name === "library" && (
        <LibraryScreen
          authenticated={screen.authenticated}
          migrationNotice={migrationNotice}
          onOpenArticle={(id) => setScreen({ name: "article", id, authenticated: screen.authenticated })}
          onOpenDailyReview={() => setScreen({ name: "resurface", authenticated: screen.authenticated })}
          onOpenFavorites={() => setScreen({ name: "favorites", authenticated: screen.authenticated })}
          onOpenTrash={() => setScreen({ name: "trash", authenticated: screen.authenticated })}
          onSignedOut={() => {
            setMigrationNotice(null);
            setScreen({ name: "login" });
          }}
        />
      )}
      {screen.name === "article" && (
        <ArticleScreen
          articleId={screen.id}
          authenticated={screen.authenticated}
          onBack={() => setScreen({ name: "library", authenticated: screen.authenticated })}
        />
      )}
      {screen.name === "resurface" && (
        <DailyReviewScreen
          authenticated={screen.authenticated}
          onBack={() => setScreen({ name: "library", authenticated: screen.authenticated })}
        />
      )}
      {screen.name === "favorites" && (
        <FavoritesScreen
          authenticated={screen.authenticated}
          onBack={() => setScreen({ name: "library", authenticated: screen.authenticated })}
          onOpenArticle={(id) => setScreen({ name: "article", id, authenticated: screen.authenticated })}
        />
      )}
      {screen.name === "trash" && (
        <TrashScreen
          authenticated={screen.authenticated}
          onBack={() => setScreen({ name: "library", authenticated: screen.authenticated })}
        />
      )}
    </>
  );
}
