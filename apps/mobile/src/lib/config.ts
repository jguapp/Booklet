// Same story as the browser extension's src/config.ts -- no build-time env
// system here either. Change this to a deployed API origin for a real build.
// 10.0.2.2 is the Android emulator's alias for the host machine's localhost;
// iOS Simulator can use localhost directly.
import { Platform } from "react-native";

export const API_URL = Platform.OS === "android" ? "http://10.0.2.2:4000" : "http://localhost:4000";
