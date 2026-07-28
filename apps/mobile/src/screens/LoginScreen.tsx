import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { ApiError, login } from "../lib/api";
import type { UserProfile } from "@booklet/shared";

export function LoginScreen({ onLoggedIn }: { onLoggedIn: (user: UserProfile) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const user = await login(email.trim(), password);
      onLoggedIn(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't log in. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Booklet</Text>
      <Text style={styles.subtitle}>
        Sign in to sync your library. This mobile app is account-only for now -- the offline/local
        mode the web app has isn't ported here yet.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Log in</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#f7f4ee" },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 8, color: "#1c1a16" },
  subtitle: { fontSize: 13, color: "#6b6558", marginBottom: 24, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderColor: "#ddd6c7",
    borderRadius: 6,
    padding: 12,
    marginBottom: 12,
    backgroundColor: "#fff",
    fontSize: 15,
  },
  button: { backgroundColor: "#b5502f", borderRadius: 6, padding: 14, alignItems: "center", marginTop: 8 },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  error: { color: "#b5502f", marginBottom: 12, fontSize: 13 },
});
