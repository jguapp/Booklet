import { useEffect, useState, useMemo } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { UserProfile } from "@booklet/shared";
import { KOKORO_VOICES } from "@booklet/shared";
import { ApiError, clearSession, deleteAccount, getProfile } from "../lib/api";
import { API_URL } from "../lib/config";
import {
  DEFAULT_PREFS,
  loadDevicePrefs,
  REMINDER_HOURS,
  saveDevicePrefs,
  TEXT_SIZES,
  TTS_RATES,
  type DevicePrefs,
} from "../lib/device-prefs";
import { useTheme, THEME_OPTIONS, type ThemePalette } from "../lib/theme";
import {
  cancelDailyReviewReminder,
  NOTIFICATIONS_SUPPORTED,
  scheduleDailyReviewReminder,
} from "../lib/notifications";

interface SettingsScreenProps {
  authenticated: boolean;
  onBack: () => void;
  onSignedOut: () => void;
}

// Device-level preferences (theme, text size, read-aloud voice/speed, the
// Daily Review reminder) plus the account section: signed-in email, log
// out, and account deletion with the same confirmation the web page uses
// -- the server re-checks a password, or the typed-out email for an
// OAuth-only account, so the UI's job is to collect the right one
// (profile.hasPassword picks the field). Still web-only on purpose:
// Kindle email, the podcast feed URL (a reveal-once secret needing a
// clipboard), session management, and import/export (file downloads).
export function SettingsScreen({ authenticated, onBack, onSignedOut }: SettingsScreenProps) {
  const { palette, choice, setChoice } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [prefs, setPrefs] = useState<DevicePrefs>(DEFAULT_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Delete-account flow: collapsed link -> confirmation form. `deleteError`
  // is separate from `error` so a wrong password renders inside the form
  // it belongs to, not at the top of the screen.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  async function handleSetReminder(hour: number | null) {
    setError(null);
    if (hour === null) {
      try {
        await cancelDailyReviewReminder();
      } catch {
        // Cancellation failing is vanishingly rare (no permission involved);
        // fall through and record "off" -- the stale notification, if any,
        // stops mattering the next time one is scheduled.
      }
      update({ reviewReminderHour: null });
      return;
    }
    let scheduled = false;
    try {
      scheduled = await scheduleDailyReviewReminder(hour);
    } catch {
      setError("Couldn't set the reminder. Try again.");
      return;
    }
    if (!scheduled) {
      // Permission refused -- recording the hour anyway would render an
      // enabled-looking control for a reminder that will never fire.
      setError("Notifications are turned off for Booklet in your device's system settings.");
      return;
    }
    update({ reviewReminderHour: hour });
  }

  async function handleDeleteAccount() {
    if (!profile || deleting) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteAccount(profile.hasPassword ? { password: deleteConfirmation } : { confirmEmail: deleteConfirmation });
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Couldn't delete the account. Try again.");
      setDeleting(false);
      return;
    }
    // The server-side sessions died with the account; clearing the local
    // token is the client half, so the next launch doesn't render a
    // signed-in shell for an account that no longer exists.
    try {
      await clearSession();
    } catch {
      // The token is dead server-side either way; the login screen is still
      // the right destination.
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

        <Text style={styles.sectionHeading}>Appearance</Text>
        <View style={styles.panel}>
          <View style={styles.chipRow}>
            {THEME_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[styles.chip, choice === option.value && styles.chipActive]}
                onPress={() => setChoice(option.value)}
              >
                <Text style={[styles.chipText, choice === option.value && styles.chipTextActive]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.hint}>
            The same four themes as Booklet on the web. System follows your device&apos;s light/dark setting.
          </Text>
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

        {NOTIFICATIONS_SUPPORTED && (
          <>
            <Text style={styles.sectionHeading}>Daily Review reminder</Text>
            <View style={styles.panel}>
              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[styles.chip, prefs.reviewReminderHour === null && styles.chipActive]}
                  onPress={() => handleSetReminder(null)}
                >
                  <Text style={[styles.chipText, prefs.reviewReminderHour === null && styles.chipTextActive]}>
                    Off
                  </Text>
                </TouchableOpacity>
                {REMINDER_HOURS.map((hour) => (
                  <TouchableOpacity
                    key={hour}
                    style={[styles.chip, prefs.reviewReminderHour === hour && styles.chipActive]}
                    onPress={() => handleSetReminder(hour)}
                  >
                    <Text style={[styles.chipText, prefs.reviewReminderHour === hour && styles.chipTextActive]}>
                      {hour}:00
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.hint}>
                A local notification scheduled on this device -- it fires with or without a connection, and nothing
                about your reading leaves the phone for it.
              </Text>
            </View>
          </>
        )}

        <Text style={styles.sectionHeading}>About</Text>
        <View style={styles.panel}>
          <Text style={styles.aboutLine}>API server: {API_URL}</Text>
          <Text style={styles.hint}>
            Kindle email, the podcast feed, signed-in devices and import/export are managed from Booklet on the
            web.
          </Text>
        </View>

        {authenticated && profile && (
          <>
            <Text style={styles.sectionHeading}>Delete account</Text>
            <View style={styles.panel}>
              <Text style={styles.accountLine}>
                Permanently deletes your account and everything in it: saved articles and uploaded files, highlights
                and notes, collections, tags, reading history, RSS subscriptions and generated audio. Shared links
                stop working for everyone who has them. This happens immediately -- there is no waiting period and
                no way to undo it.
              </Text>
              {!deleteOpen ? (
                <TouchableOpacity
                  onPress={() => {
                    setDeleteOpen(true);
                    setDeleteConfirmation("");
                    setDeleteError(null);
                  }}
                >
                  <Text style={styles.dangerLink}>Delete my account</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <Text style={styles.fieldLabel}>
                    {profile.hasPassword
                      ? "Enter your password to confirm"
                      : `Type ${profile.email} to confirm`}
                  </Text>
                  {/* The server re-checks this -- password for password
                      accounts, the typed-out address for OAuth-only ones
                      (there's no password to verify, so typing the address
                      is the deliberate act that stands in for it). */}
                  <TextInput
                    style={styles.deleteInput}
                    autoFocus
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry={profile.hasPassword}
                    keyboardType={profile.hasPassword ? "default" : "email-address"}
                    placeholderTextColor={palette.inkFaint}
                    placeholder={profile.hasPassword ? "••••••••" : profile.email}
                    value={deleteConfirmation}
                    onChangeText={setDeleteConfirmation}
                  />
                  {deleteError && <Text style={styles.deleteError}>{deleteError}</Text>}
                  <View style={styles.deleteActions}>
                    <TouchableOpacity
                      style={[styles.dangerButton, (deleting || deleteConfirmation.length === 0) && styles.dangerButtonDisabled]}
                      disabled={deleting || deleteConfirmation.length === 0}
                      onPress={handleDeleteAccount}
                    >
                      {deleting ? (
                        <ActivityIndicator color={palette.accentContrast} size="small" />
                      ) : (
                        <Text style={styles.dangerButtonText}>Delete permanently</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      disabled={deleting}
                      onPress={() => {
                        setDeleteOpen(false);
                        setDeleteConfirmation("");
                        setDeleteError(null);
                      }}
                    >
                      <Text style={styles.secondaryButtonText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
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
  title: { fontSize: 24, fontWeight: "700", color: t.ink, marginBottom: 16 },
  error: { color: t.danger, fontSize: 12, marginBottom: 8 },
  scrollContent: { paddingBottom: 32 },
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
  accountLine: { fontSize: 13, color: t.inkMuted, lineHeight: 19, marginBottom: 10 },
  secondaryButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 6,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  secondaryButtonText: { fontSize: 13, fontWeight: "600", color: t.ink },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: t.surface,
  },
  chipActive: { borderColor: t.accent, backgroundColor: t.accentSoft },
  chipText: { fontSize: 13, color: t.inkMuted },
  chipTextActive: { color: t.accent, fontWeight: "600" },
  preview: { marginTop: 12, color: t.ink },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: t.inkMuted, marginBottom: 8 },
  voiceRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 },
  radio: { fontSize: 14, color: t.inkFaint },
  radioActive: { color: t.accent },
  voiceLabel: { fontSize: 13, color: t.ink, flex: 1 },
  hint: { fontSize: 11, color: t.inkFaint, marginTop: 10, lineHeight: 16 },
  aboutLine: { fontSize: 13, color: t.inkMuted },
  dangerLink: { fontSize: 13, fontWeight: "600", color: t.danger },
  deleteInput: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 6,
    padding: 10,
    backgroundColor: t.paper,
    fontSize: 14,
    color: t.ink,
    marginBottom: 8,
  },
  deleteError: { color: t.danger, fontSize: 12, marginBottom: 8 },
  deleteActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  dangerButton: {
    backgroundColor: t.danger,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    minWidth: 150,
    alignItems: "center",
  },
  dangerButtonDisabled: { opacity: 0.5 },
  dangerButtonText: { fontSize: 13, fontWeight: "600", color: t.accentContrast },
});
