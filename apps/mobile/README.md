# Booklet mobile app

An Expo/React Native scaffold: log in, see your library, save a URL, read
an article's extracted text. Reuses the same API and `@booklet/shared`
types as the web app, per the README roadmap's "reusing the same API and
data model rather than a rewrite."

## Scope of this scaffold

Authenticated only, same reasoning as the browser extension -- no
IndexedDB-equivalent local-first layer on mobile yet (that'd mean building
a whole separate offline storage story on `expo-sqlite` or similar, a real
project of its own, not a scaffold-stage add-on).

Read-only reader -- no highlighting. The web app's highlighting is built on
the browser's Selection/Range APIs (`lib/reader/dom-range.ts`), which don't
exist in React Native; a mobile equivalent needs a native text-selection
approach, not a port of that code.

No navigation library -- three screens and a session check don't need React
Navigation's setup (and its native-linking config) for a scaffold this
size. Worth adding once there's more than three screens.

## Develop

```bash
pnpm install
pnpm --filter @booklet/mobile web       # Expo's web target, in a browser
pnpm --filter @booklet/mobile ios       # needs Xcode + an iOS Simulator (macOS only)
pnpm --filter @booklet/mobile android   # needs Android Studio + an emulator
```

Points at `http://localhost:4000` (`10.0.2.2:4000` on the Android emulator,
which aliases the host machine) by default -- see `src/lib/config.ts`.

## Verified, and what wasn't

Type-checks clean (`tsc --noEmit`). Getting Metro's web bundler running in
this pnpm workspace hit real friction, not fixed yet: an Expo-SDK
dependency-version mismatch (`expo install --fix` realigned that part) and
then a `@babel/traverse` / `@babel/core` resolution gap -- Metro's transform
workers `require()` babel packages from deep inside other dependencies'
directories, which pnpm's strict per-package `node_modules` doesn't expose
the way npm/yarn's flatter layout would. This is a known category of
pnpm + Metro/React-Native friction, not a bug in this app's code; the usual
fixes are a `.npmrc` with `node-linker=hoisted` (changes dependency
resolution for the whole monorepo, not just this app -- didn't want to risk
that blind) or a custom `metro.config.js` resolver. Whoever picks this up
next should start there.

This environment also has no iOS Simulator, Android emulator, or physical
device to run the app on. So unlike the web app (verified via Playwright)
and the browser extension (verified by loading the real built extension in
Chromium), none of this has been exercised interactively -- treat it as a
real, type-checked starting point, not something confirmed working end to
end the way the rest of this session's work is.

Also out of reach in this environment: publishing to the App Store or Play
Store, which need Apple/Google developer accounts.
