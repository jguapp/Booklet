# Booklet mobile app

An Expo/React Native app: continue without an account or log in, see your
library, save a URL or upload a PDF/EPUB, organize into collections, search
your library, favorite and trash articles, read and highlight, browse all
your highlights with notes and recall prompts, check your reading stats and
Recap, and run Daily Review. Reuses the same API and `@booklet/shared`
types as the web app, per the README roadmap's "reusing the same API and
data model rather than a rewrite."

## Scope

**Local-first, like the web app.** `src/lib/local/db.ts` is an
AsyncStorage-backed equivalent of the web app's IndexedDB layer (articles,
highlights, collections, and article-collection links as JSON, keyed by id
-- AsyncStorage is a flat key/value store, so no real indexes the way
IndexedDB has), and `src/lib/data/*.ts` is the same local-vs-API
repository-pattern swap point the web app uses. Logging in migrates
whatever's saved locally onto the account via the same `POST
/api/sync/import` endpoint the web app's migration uses
(`src/lib/data/sync.ts`), collections included.

**PDF/EPUB** -- upload (via `expo-document-picker`) works the same signed
in or not, same as web: the extraction endpoint never required an account.
Unlike web, there's no real page/CFI rendering here (that's DOM canvas and
iframe rendering, neither of which React Native has) -- PDF/EPUB show as
extracted text through the same `ArticleScreen` HTML articles use,
highlighting included. Picked-file uploads needed a platform branch:
`expo-document-picker`'s native result gives a `{uri, name, type}` object
real Android/iOS `FormData` streams directly from disk, but the *web*
target's picker instead returns a real `File` (`asset.file` -- confirmed
by hand that sending the `{uri, name, type}` form to a real browser's
`fetch` produces a malformed empty part, a 400 from the API). See
`saveArticleFromFile`'s `PickedFile` type in `src/lib/data/articles.ts`.

**Collections** -- lighter UI than the web app's: no rename/delete/color,
just create and toggle membership. Selecting a collection chip shows every
article with a ✓/+ toggle rather than filtering to members-only -- caught
by hand that filtering to members-only hides exactly the non-member
articles the + button exists to add, since a hidden card's button can
never be tapped.

**Search, favorites, and trash** -- the everyday library actions the web
app has, now on mobile too. The Library screen has a client-side search box
(title / site / author / excerpt, filtered in memory over the already-
loaded list -- no round trip) and per-card ★ favorite and 🗑 delete
buttons, both optimistic. Two screens back them: `FavoritesScreen` (the
favorited articles, newest-saved first) and `TrashScreen` (soft-deleted
articles, kept 30 days, with Restore / Delete forever / Empty trash). Delete
from the Library is a *soft* delete -- it sets `deletedAt` and the article
moves to Trash rather than vanishing, which is why the Library button
doesn't confirm and the Trash buttons do. The destructive Trash actions arm
on the first tap and fire on the second (an inline "Tap to confirm") rather
than using `Alert.alert`, which is a hard no-op on react-native-web, the one
target this app runs on today (same reason the highlight-removal confirm is
noted as unexercised below). All of it routes through
`src/lib/data/articles.ts` the same way everything else does -- a PATCH/DELETE
when signed in, a read-modify-put against AsyncStorage when not -- and
`localArticles.getAll()` now filters out soft-deleted rows so a trashed
local article stops coming back into the library list.

**Daily Review** -- `DailyReviewScreen` mirrors the web app's `/resurface`
page: authenticated mode asks `GET /api/digests/current` for the
server-persisted batch (stable across a reopen or a second device); local
mode re-runs `selectHighlightsToResurface` from `@booklet/shared` against
every local highlight on each visit (fine single-device, which is all
local mode ever is). Same SM-2 feedback loop (`applySm2Review`) either way.

**Highlighting** -- but through a different interaction than the web app's,
because React Native has no single component that both reports a user's
text selection *and* renders per-substring styling the way a browser's
Selection/Range API + styled `<mark>` elements do. `Text` renders rich
nested styling but exposes no selection events; `TextInput` is the only
component with `onSelectionChange`, but can't mix styled runs into its
value. `ArticleScreen` toggles between the two: a "Select text" mode swaps
in a plain, edit-blocked `TextInput` (`value` stays bound to the article's
text and `onChangeText` is a no-op, so nothing can actually be typed; a
software keyboard is suppressed via `showSoftInputOnFocus={false}`) to
capture a selection range, then a color swatch bar creates the highlight
and switches back to a `Text` tree with the highlighted run rendered as a
styled nested `Text`. Anchoring reuses `computeTextPosition` from
`@booklet/shared` unchanged -- it's already just plain-text-offset based,
the same one the web app uses for HTML articles, and mobile only ever
highlights `extractedText`, never a PDF/EPUB position.

**Highlights browsing** -- `HighlightsScreen` mirrors the web app's
/highlights page minus sharing and onboarding seeds: grouped-by-article
cards when browsing everything (only when there are 2+ articles with
highlights, same rule as web), a flat list once an article is picked or a
search is typed (reading order within one article -- mobile only ever
creates plain-text positions, so `position.start` is the whole ordering;
creation order across articles), search over highlight text and notes, and
per-highlight actions: add/edit a note, add/edit a recall prompt (#157 --
shown as a question in Daily Review before the reveal), and delete with the
same two-tap inline confirm Trash uses. Emptying a note and saving removes
it (the API's annotation DELETE is a `deleteMany`, so deleting a
never-created note is a safe no-op). The reader (`ArticleScreen`) also
gained the two article-level edits whose data functions previously had no
UI: a status chip row (Unread / Reading / Archived) and inline rename --
explicit Save/Cancel buttons rather than submit-on-blur, because the
collection input's Done-press-also-blurs double-fire is a class of bug two
buttons can't have.

**Stats and Recap** -- ports of the web pages, computed by the same
`computeReadingStats` / `computeRecap` from `@booklet/shared` over the same
loaded article list. `StatsScreen` has the six stat cards, the past-year
reading heatmap (real per-day minutes from `/api/stats/reading-activity`
when signed in; the articles-finished-per-day `archivedAt` heuristic in
local mode, same fallback as web -- mobile itself doesn't track reading
time yet), top tags, and the by-source breakdown. The heatmap starts
scrolled to its right end, where "now" is, and has no per-day tooltips (no
hover on a touch screen, and an 11px square isn't a tap target).
`RecapScreen` is the week/month toggle and big numbers, minus web's "Copy
summary" -- RN's core Clipboard is deprecated and `expo-clipboard` isn't a
dependency that one button justifies adding. `formatDuration` is copied
into `src/lib/format.ts` rather than moved to shared, since it's the only
formatter mobile needs.

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
which aliases the host machine) by default -- see `src/lib/config.ts`. For a
real (TestFlight / Play / production) build, set `EXPO_PUBLIC_API_URL` to the
deployed API's origin; Expo inlines any `EXPO_PUBLIC_*` variable into the
bundle at build time, so this is the build-time config the app previously had
no way to set -- without it a shipped build would talk to `localhost`, which
is only reachable from a simulator on the same host.

All four scripts run with `EXPO_OFFLINE=1` baked in (via `cross-env`, for
Windows compatibility -- plain `VAR=value cmd` isn't reliably portable in a
package.json script). This skips `expo start`'s own startup call to Expo's
API for SDK/dependency-compatibility data (`expo:doctor:dependencies:*` in
`EXPO_DEBUG=1` output) -- confirmed by hand that this isn't a local network,
proxy, or cache problem (every one of Expo's own endpoints answered fine
directly, via both `curl` and a plain Node `fetch`, seconds apart from a
failing `expo start`) but genuine intermittent flakiness from that specific
API: one direct call returned real data, the next returned `{"data":[]}` (an
empty array Expo's own client treats as an error), and `expo start` itself
failed outright with an unhandled `TypeError: fetch failed` more than once.
Since that check is advisory only -- it's not required for Metro to actually
serve anything -- skipping it is the right default rather than something to
remember to type by hand every time this happens.

## Verified, and what wasn't

The web target now actually runs, end to end -- confirmed with Playwright
against the real dev API, both signed out and signed in: sign up, log in,
land on the Library, save a URL with real extraction, see it listed;
continue without an account, save a URL into AsyncStorage, then log in and
confirm the same article survives the migration into the account; select
a text range in an article (simulating a real drag-select via the
underlying `<textarea>` react-native-web renders a multiline `TextInput`
as), create a highlight, confirm it persists across a reload, and confirm
the highlight's `onPress` handler fires correctly with the right id when
tapped (proven by a temporary `console.log`, since the actual removal it
triggers goes through `Alert.alert`, and react-native-web's `Alert.alert`
is a hard no-op -- `static alert() {}` in
`node_modules/react-native-web/src/exports/Alert` -- so confirm-and-remove
itself couldn't be exercised on this target; real iOS/Android has a fully
working native `Alert.alert`, so this is a gap in the web target used for
development, not in the removal code, but should be the first thing
re-checked on a real device); create a collection, upload a real EPUB
(server-verified 200 from `/api/extract-file`, not just a UI check), add
it to the collection and confirm the ✓/+ toggle and persistence across a
reload, highlight the uploaded EPUB's extracted text, and run it through
Daily Review end to end (see the highlight in the batch, mark it
Remembered, see the "nicely done" empty state). `tsc --noEmit` is clean
across the whole app.

Also caught and fixed a real bug while testing, beyond the file-upload
platform branch already described above: the new-collection input had
`onSubmitEditing` and `onBlur` both wired to the same create handler, so
pressing Enter (which also blurs the input) could fire it twice before
React committed the first call's state, sending a duplicate create that
came back "already exists" -- fixed with a ref-based in-flight guard,
`creatingCollectionRef`.

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

### Changed since that pass, and not re-run

A later audit against the web app's `lib/data/*` found divergences and
unhandled async paths and fixed them. `tsc --noEmit` is clean, but **none of
the following has been executed** -- not on a device, not on the web target:

- **Migration is now batched** (`src/lib/data/sync.ts`), the way the web
  client's is. It used to POST the whole local library as one body against a
  32MB route limit, which a few image-heavy saves exceed on their own; the
  failure surfaced as a signed-in library that was simply empty. Batches are
  cleared from AsyncStorage only after the server accepts them, and
  `localArticles.deleteMany` exists because clearing a batch with a
  `Promise.all` of single-id deletes would have had them overwrite each
  other -- every entity type is one JSON map under one key.
- **Highlight colors** come from `@booklet/shared` rather than a hand-copied
  list. `HighlightColor` is any legacy name *or* a literal `#RRGGBB` now, and
  a custom color from the web found no entry in that list, so it rendered with
  no background at all.
- **`textSource` and `canonicalUrl`** are populated on locally-saved articles,
  matching the web app: the first is the only marker that a PDF's text came
  from OCR, the second is what makes local duplicate detection catch a
  tracking-param variant of an already-saved URL.
- **Error handling** on every async path that previously rejected into
  nothing: library load, collection membership load and toggle, file picker,
  logout, article load, highlight removal, Daily Review load and grading, the
  startup session check, and the login-time migration. Several of these left
  the user with no feedback at all -- a blank Daily Review, a "Nothing here
  yet." that meant "couldn't reach the API", a launch spinner that never
  cleared if the stored session was corrupt.

Worth re-checking first on a real device: that the migration notice actually
renders on the Library screen (it is a `Text` row, not an `Alert`, precisely
because react-native-web's `Alert.alert` is a no-op), and that a batched
migration of a genuinely large library completes.

Still real, unresolved gaps: this environment has no iOS Simulator,
Android emulator, or physical device, so `ios`/`android` remain
type-checked-only, not run. And still out of reach entirely: publishing to
the App Store or Play Store, which need Apple/Google developer accounts.
