// The API origin this build talks to.
//
// For a real (TestFlight / Play / production) build, set EXPO_PUBLIC_API_URL
// to the deployed API's origin -- Expo inlines any EXPO_PUBLIC_* variable into
// the bundle at build time, so this is the build-time env system the rest of
// this app didn't have. Without it the fallbacks below point at a dev machine,
// which is only reachable from a simulator on the same host.
//
// 10.0.2.2 is the Android emulator's alias for the host machine's localhost;
// the iOS Simulator can use localhost directly.
import { Platform } from "react-native";

const configured = process.env.EXPO_PUBLIC_API_URL;

export const API_URL =
  configured && configured.length > 0
    ? configured
    : Platform.OS === "android"
      ? "http://10.0.2.2:4000"
      : "http://localhost:4000";
