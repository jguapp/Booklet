import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import type { UserProfile } from "@booklet/shared";
import { getSession } from "./src/lib/api";
import { LoginScreen } from "./src/screens/LoginScreen";
import { LibraryScreen } from "./src/screens/LibraryScreen";
import { ArticleScreen } from "./src/screens/ArticleScreen";

// No navigation library -- three screens and a session check don't need
// React Navigation's setup (and its native-linking config) for a scaffold.
type Screen = { name: "login" } | { name: "library" } | { name: "article"; id: string };

export default function App() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [screen, setScreen] = useState<Screen>({ name: "login" });
  const [, setUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    getSession()
      .then((session) => {
        if (session) setScreen({ name: "library" });
      })
      .finally(() => setCheckingSession(false));
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
          onLoggedIn={(loggedInUser) => {
            setUser(loggedInUser);
            setScreen({ name: "library" });
          }}
        />
      )}
      {screen.name === "library" && (
        <LibraryScreen
          onOpenArticle={(id) => setScreen({ name: "article", id })}
          onLoggedOut={() => {
            setUser(null);
            setScreen({ name: "login" });
          }}
        />
      )}
      {screen.name === "article" && (
        <ArticleScreen articleId={screen.id} onBack={() => setScreen({ name: "library" })} />
      )}
    </>
  );
}
