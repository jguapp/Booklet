import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { UserProfile } from "@booklet/shared";
import { KOKORO_VOICES } from "@booklet/shared";
import { clearSession, getProfile } from "../lib/api";
import { API_URL } from "../lib/config";
import {
  DEFAULT_PREFS,
  loadDevicePrefs,
  saveDevicePrefs,
  TEXT_SIZES,
  TTS_RATES,
  type DevicePrefs,
} from "../lib/device-prefs";

interface SettingsScreenProps {
  authenticated: boolean;
  onBack: () => void;
  onSignedOut: () => void;
}

// Device-level preferences plus a light account section. Deliberately much
// smaller than the web Settings: Kindle email, the podcast feed URL,
// session management, import/export and account deletion all stay web-only
// -- each either needs UI this app doesn't have (secure URL reveal +
// clipboard, file downloads) or is destructive enough that it shouldn't
// exist without its full confirmation flow (deletion re-checks the
// password server-side; see the web page). The prefs that *are* here are
// exactly the ones that belong to the device rather than the account:
// text size and the read-aloud voice/speed.
export function SettingsScreen({ authenticated, onBack, onSignedOut }: SettingsScreenProps) {
  const [prefs, setPrefs] = useState<DevicePrefs>(DEFAULT_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadDevicePrefs().then((loaded) => {
      if (!cancelled) {
        setPrefs(loaded);
        setPrefsLoaded(true);
      }
    });
    if (authenticated) {
      getProfile()
        .then((p) => {
          if (!cancelled) setProfile(p);
        })
        .catch(() => {
          // The account row degrades to "Signed in" -- the prefs below are
          // the reason this screen exists and they don't need the network.
        });
    }
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  function update(patch: Partial<DevicePrefs>) {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      // Fire-and-forget: a failed AsyncStorage write leaves the in-memory
      // state applied for this session, which is the best available outcome.
      void saveDevicePrefs(next);
      return next;
    });
  }

  async function handleLogout() {
    try {
      await clearSession();
    } catch {
      setError("Couldn't log out on this device. Try again.");
      return;
    }
    onSignedOut();
  }

  if (!prefsLoaded) {
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
      <Text style={styles.title}>Settings</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionHeading}>Account</Text>
        <View style={styles.panel}>
          {authenticated ? (
            <>
              <Text style={styles.accountLine}>
                {profile ? `Signed in as ${profile.email}.` : "Signed in."} Your saves and highlights sync across
                devices.
              </Text>
              <TouchableOpacity style={styles.secondaryButton} onPress={handleLogout}>
                <Text style={styles.secondaryButtonText}>Log out</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.accountLine}>
              Not signed in -- everything is saved locally on this device only. Log in from the Library screen to
              sync.
            </Text>
          )}
        </View>

        <Text style={styles.sectionHeading}>Text size</Text>
        <View style={styles.panel}>
          <View style={styles.chipRow}>
            {TEXT_SIZES.map((s) => (
              <TouchableOpacity
                key={s.value}
                style={[styles.chip, prefs.textSize === s.value && styles.chipActive]}
                onPress={() => update({ textSize: s.value })}
              >
                <Text style={[styles.chipText, prefs.textSize === s.value && styles.chipTextActive]}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.preview, { fontSize: TEXT_SIZES.find((s) => s.value === prefs.textSize)!.fontSize }]}>
            Article text will read like this.
          </Text>
        </View>

        <Text style={styles.sectionHeading}>Read aloud</Text>
        <View style={styles.panel}>
          <Text style={styles.fieldLabel}>Voice</Text>
          {KOKORO_VOICES.map((v) => (
            <TouchableOpacity key={v.id} style={styles.voiceRow} onPress={() => update({ ttsVoice: v.id })}>
              <Text style={[styles.radio, prefs.ttsVoice === v.id && styles.radioActive]}>
                {prefs.ttsVoice === v.id ? "●" : "○"}
              </Text>
              <Text style={styles.voiceLabel}>{v.label}</Text>
            </TouchableOpacity>
          ))}
          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Speed</Text>
          <View style={styles.chipRow}>
            {TTS_RATES.map((rate) => (
              <TouchableOpacity
                key={rate}
                style={[styles.chip, prefs.ttsRate === rate && styles.chipActive]}
                onPress={() => update({ ttsRate: rate })}
              >
                <Text style={[styles.chipText, prefs.ttsRate === rate && styles.chipTextActive]}>{rate}×</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.hint}>
            Voices are generated on the Booklet server, so read-aloud needs a connection.
          </Text>
        </View>

        <Text style={styles.sectionHeading}>About</Text>
        <View style={styles.panel}>
          <Text style={styles.aboutLine}>API server: {API_URL}</Text>
          <Text style={styles.hint}>
            Kindle email, the podcast feed, signed-in devices, import/export and account deletion are managed from
            Booklet on the web.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f7f4ee", paddingTop: 56, paddingHorizontal: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f7f4ee" },
  back: { color: "#b5502f", fontSize: 14, fontWeight: "600", marginBottom: 12 },
  title: { fontSize: 24, fontWeight: "700", color: "#1c1a16", marginBottom: 16 },
  error: { color: "#b5502f", fontSize: 12, marginBottom: 8 },
  scrollContent: { paddingBottom: 32 },
  sectionHeading: {
    fontSize: 11,
    fontWeight: "600",
    color: "#6b6558",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  panel: {
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ece6d8",
    padding: 14,
    marginBottom: 20,
  },
  accountLine: { fontSize: 13, color: "#3d3a33", lineHeight: 19, marginBottom: 10 },
  secondaryButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#ddd6c7",
    borderRadius: 6,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  secondaryButtonText: { fontSize: 13, fontWeight: "600", color: "#1c1a16" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: "#ddd6c7",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: "#fff",
  },
  chipActive: { borderColor: "#b5502f", backgroundColor: "#fbe9e3" },
  chipText: { fontSize: 13, color: "#6b6558" },
  chipTextActive: { color: "#b5502f", fontWeight: "600" },
  preview: { marginTop: 12, color: "#1c1a16" },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: "#3d3a33", marginBottom: 8 },
  voiceRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 },
  radio: { fontSize: 14, color: "#b0a998" },
  radioActive: { color: "#b5502f" },
  voiceLabel: { fontSize: 13, color: "#1c1a16", flex: 1 },
  hint: { fontSize: 11, color: "#a49d8e", marginTop: 10, lineHeight: 16 },
  aboutLine: { fontSize: 13, color: "#3d3a33" },
});
