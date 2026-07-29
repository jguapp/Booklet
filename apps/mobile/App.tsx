import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { getSession } from "./src/lib/api";
import { migrateLocalDataToAccount } from "./src/lib/data/sync";
import { LoginScreen } from "./src/screens/LoginScreen";
import { LibraryScreen } from "./src/screens/LibraryScreen";
import { ArticleScreen } from "./src/screens/ArticleScreen";
import { DailyReviewScreen } from "./src/screens/DailyReviewScreen";

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
  | { name: "resurface"; authenticated: boolean };

export default function App() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [screen, setScreen] = useState<Screen>({ name: "login" });

  useEffect(() => {
    async function restore() {
      const session = await getSession();
      if (session) setScreen({ name: "library", authenticated: true });
      setCheckingSession(false);
    }
    restore();
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
            // Best-effort, same as the web app's runMigration -- local data
            // (if there is any) is left untouched on failure, so it isn't
            // lost, just not synced yet.
            await migrateLocalDataToAccount().catch(() => undefined);
            setScreen({ name: "library", authenticated: true });
          }}
          onContinueWithoutAccount={() => setScreen({ name: "library", authenticated: false })}
        />
      )}
      {screen.name === "library" && (
        <LibraryScreen
          authenticated={screen.authenticated}
          onOpenArticle={(id) => setScreen({ name: "article", id, authenticated: screen.authenticated })}
          onOpenDailyReview={() => setScreen({ name: "resurface", authenticated: screen.authenticated })}
          onSignedOut={() => setScreen({ name: "login" })}
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
    </>
  );
}
