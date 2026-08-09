/**
 * A stable, opaque id for this install -- written into
 * Article.listeningDeviceId so the web reader's resume prompt can tell
 * "you left off here on your phone" from "this device wrote this a moment
 * ago". Identifies an app install, not a person; mirrors the web's
 * lib/reader/device-id.ts (which does the same with localStorage).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { generateLocalId } from "./local/db";

const KEY = "booklet_device_id";

let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (stored) {
      cached = stored;
      return stored;
    }
    const fresh = generateLocalId();
    await AsyncStorage.setItem(KEY, fresh);
    cached = fresh;
    return fresh;
  } catch {
    // Storage unavailable: fall back to a per-launch id. Positions still
    // sync; only the "same device?" comparison degrades, and only until
    // the next launch.
    cached = cached ?? generateLocalId();
    return cached;
  }
}
