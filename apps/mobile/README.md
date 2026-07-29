# Booklet mobile app

An Expo/React Native app: continue without an account or log in, see your
library, save a URL, read an article's extracted text. Reuses the same API
and `@booklet/shared` types as the web app, per the README roadmap's
"reusing the same API and data model rather than a rewrite."

## Scope

**Local-first, like the web app.** `src/lib/local/db.ts` is an
AsyncStorage-backed equivalent of the web app's IndexedDB layer (`Article`s
and `Highlight`s as JSON, keyed by id -- AsyncStorage is a flat key/value
store, so no real indexes the way IndexedDB has), and `src/lib/data/*.ts`
is the same local-vs-API repository-pattern swap point the web app uses.
Logging in migrates whatever's saved locally onto the account via the same
`POST /api/sync/import` endpoint the web app's migration uses
(`src/lib/data/sync.ts`) -- mobile just never sends `collections`, since
there's no collections UI here yet.

Read-only reader -- no highlighting. The web app's highlighting is built on
the browser's Selection/Range APIs (`lib/reader/dom-range.ts`), which don't
exist in React Native; a mobile equivalent needs a native text-selection
approach, not a port of that code. (`localHighlights` already exists in the
local storage layer, ready for whenever that lands.)

No navigation library -- a handful of screens and a session check don't
need React Navigation's setup (and its native-linking config) for an app
this size. Worth adding once there's meaningfully more than this.

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
against the real dev API, both ways: (a) sign up, log in, land on the
Library, save a URL with real extraction, see it listed, and (b) continue
without an account, save a URL into AsyncStorage, then log in and confirm
the same article survives the migration into the account -- the local/
account boundary this app shares with the web app, actually exercised end
to end, not just typechecked. `tsc --noEmit` is clean across the whole app.

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
