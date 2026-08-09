import { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { ApiError, login } from "../lib/api";
import { useTheme, type ThemePalette } from "../lib/theme";

interface LoginScreenProps {
  onLoggedIn: () => void;
  onContinueWithoutAccount: () => void;
}

export function LoginScreen({ onLoggedIn, onContinueWithoutAccount }: LoginScreenProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
      onLoggedIn();
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
        No account needed to save and read articles -- sign in only if you want your library synced
        across devices.
      </Text>

      <TextInput
        style={styles.input}
        placeholderTextColor={palette.inkFaint}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholderTextColor={palette.inkFaint}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={submitting}>
        {submitting ? <ActivityIndicator color={palette.accentContrast} /> : <Text style={styles.buttonText}>Log in</Text>}
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryButton} onPress={onContinueWithoutAccount} disabled={submitting}>
        <Text style={styles.secondaryButtonText}>Continue without an account</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (t: ThemePalette) =>
  StyleSheet.create({
    container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: t.paper },
    title: { fontSize: 28, fontWeight: "700", marginBottom: 8, color: t.ink },
    subtitle: { fontSize: 13, color: t.inkMuted, marginBottom: 24, lineHeight: 18 },
    input: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 6,
      padding: 12,
      marginBottom: 12,
      backgroundColor: t.surface,
      fontSize: 15,
      color: t.ink,
    },
    button: { backgroundColor: t.accent, borderRadius: 6, padding: 14, alignItems: "center", marginTop: 8 },
    buttonText: { color: t.accentContrast, fontWeight: "600", fontSize: 15 },
    secondaryButton: { padding: 14, alignItems: "center", marginTop: 4 },
    secondaryButtonText: { color: t.inkMuted, fontWeight: "600", fontSize: 14 },
    error: { color: t.danger, marginBottom: 12, fontSize: 13 },
  });
