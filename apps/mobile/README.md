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

The web target now actually runs, end to end -- confirmed with Playwright
against the real dev API: sign up, log in, land on the Library, save a URL
(real extraction, not a stub), and see it listed. `tsc --noEmit` is clean
across the whole app.

Getting there took two separate fixes for pnpm + Metro/React Native
friction, both now permanent parts of this repo rather than "whoever picks
this up next should start there":

1. **`main` pointed at `node_modules/expo/AppEntry.js`**, whose own source
   does `import App from "../../App"` -- raw relative-path filesystem math
   from wherever the `expo` package physically resolves, not a real
   monorepo-aware lookup. In a pnpm workspace that's not reliably two
   directories above this app's root. Fixed by giving the app its own
   `index.ts` (registers `App` directly, importing `expo` as a normal bare
   specifier) and pointing `package.json`'s `main` at that instead -- see
   `index.ts`'s comment.
2. **Metro couldn't resolve through pnpm's node_modules on Windows.**
   pnpm links workspace dependencies via NTFS junctions on Windows (not
   symlinks), confirmed by hand (`Get-Item node_modules/expo | Select
   LinkType` reported `Junction`); Metro's `unstable_enableSymlinks`
   resolver option (set in `metro.config.js`) doesn't traverse those the
   way it does POSIX symlinks. Fixed at the root by setting `nodeLinker:
   hoisted` in `pnpm-workspace.yaml` -- a flat, real-directory
   `node_modules` layout with no junctions/symlinks at all. This is a
   whole-monorepo setting, not mobile-only; see that file's comment for
   the tradeoff (loses pnpm's strict phantom-dependency protection) and
   the full regression pass (every package's typecheck/lint/build/test/e2e
   suite) that verified nothing else broke.

Also needed `@babel/runtime` as an explicit direct dependency (joining
`@babel/core` / `@babel/traverse`, already pinned for the same reason):
Metro's transform workers need it resolvable from this app's own
`node_modules`, and pnpm doesn't hoist transitive deps there by default.

Still real, unresolved gaps: this environment has no iOS Simulator,
Android emulator, or physical device, so `ios`/`android` remain
type-checked-only, not run. And still out of reach entirely: publishing to
the App Store or Play Store, which need Apple/Google developer accounts.
