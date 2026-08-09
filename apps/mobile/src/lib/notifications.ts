/**
 * The Daily Review reminder -- a locally-scheduled notification, not remote
 * push. There is no push infrastructure to build on (the API has no sender,
 * no device-token store), and a fixed-time daily reminder doesn't need any:
 * expo-notifications schedules it on-device and the OS fires it, network or
 * not. If server-driven notifications ever exist ("your digest is ready"),
 * that's a token registry and a sender service first, not a change here.
 *
 * Not supported on the web target -- expo-notifications is native-only --
 * so Settings hides the section there rather than showing controls that
 * can't work.
 */
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

export const NOTIFICATIONS_SUPPORTED = Platform.OS !== "web";

const CHANNEL_ID = "daily-review";

/**
 * Schedules the daily reminder at `hour`:00, replacing any existing one.
 * Returns false when the OS permission was refused -- the caller's cue to
 * show "enable notifications in system settings" rather than pretending the
 * reminder is set.
 */
export async function scheduleDailyReviewReminder(hour: number): Promise<boolean> {
  if (!NOTIFICATIONS_SUPPORTED) return false;

  let { granted } = await Notifications.getPermissionsAsync();
  if (!granted) {
    granted = (await Notifications.requestPermissionsAsync()).granted;
  }
  if (!granted) return false;

  if (Platform.OS === "android") {
    // Android 8+ requires a channel; DEFAULT importance shows the banner
    // without the heads-up interruption a reminder doesn't warrant.
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Daily Review reminder",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  // This app schedules exactly one notification, so cancel-all is the
  // simplest correct "replace": no identifier bookkeeping to leak.
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "Daily Review",
      body: "A few of your highlights are ready to revisit.",
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute: 0,
      channelId: CHANNEL_ID,
    },
  });
  return true;
}

export async function cancelDailyReviewReminder(): Promise<void> {
  if (!NOTIFICATIONS_SUPPORTED) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}
