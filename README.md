# Booklet

Booklet is a read-it-later and annotation app for people who save more than
they read. Save an article, read it in a clean distraction-free view,
highlight and annotate as you go, and have those highlights resurface later
instead of disappearing into a list you never reopen.

No account is required to use any of this — saves and highlights live in
the browser (IndexedDB) by default. Creating an account is opt-in and exists
for one reason: syncing your library and highlights across devices. Signing
in for the first time migrates whatever's already saved locally onto the
account, rather than leaving it behind.

**This is proprietary software.** Booklet is not open source. No license is
granted for use, modification, or redistribution of any part of this
repository — see [License](#license).

## Status

The full save → read → highlight → resurface loop works end to end, backed
by a real API and database, with account creation genuinely optional
throughout:

- [x] Core data model — Prisma schema for User, Article, Highlight,
      Annotation, Collection, Digest, Session, and password-reset/email-
      verification tokens, migrated to a live database
- [x] Auth — sign up / log in / log out, password reset, email verification,
      and per-device session management (list + revoke, "log out other
      devices"). Email/password, short-lived JWT access tokens, rotated
      opaque refresh tokens stored hashed server-side. **Entirely
      optional** — every route works signed out
- [x] Save article by URL — server-side fetch + Readability extraction, with
      SSRF hardening (blocks private/loopback/link-local targets on every
      redirect hop)
- [x] Save PDF/EPUB — server-side extraction via the same stateless endpoint
      either way, signed in or not. Real rendering, not extracted text: PDF
      pages render via pdfjs-dist (canvas + a precisely-positioned text
      layer for selection), EPUB chapters render via epub.js (paginated,
      real iframe rendering). Highlights anchor by page+rects (PDF) or CFI
      range (EPUB) — the `HighlightPosition` variants the schema reserved
      for this are no longer unused
- [x] Reading list / library view — IndexedDB-backed when signed out, synced
      via the API when signed in, same UI either way. Delete, archive,
      organize into collections (folders), and tag (free-form, lighter-weight
      than collections — no separate entity, no color) in both modes
- [x] Full-text search — title/excerpt/author/site/body-text/tags for
      articles, selected text/notes for highlights. Plain case-insensitive
      matching rather than Postgres tsvector, on purpose: local/anonymous
      mode has no full-text index at all, so both modes behave the same way
      instead of signed-in users getting relevance-ranked results local mode
      structurally can't match
- [x] Reading progress persistence — periodic + visibility-triggered saves
      (not just on navigate-away — a hard reload or tab close can interrupt
      an in-flight async write before that would fire) for all three reader
      kinds, resuming scroll position (HTML), page (PDF), or chapter
      (EPUB, via epub.js's own location index) on next open
- [x] Reader view — light/dark/sepia theming, adjustable type size,
      select-to-highlight with optional notes, drift-tolerant highlight
      re-anchoring
- [x] Highlights dashboard
- [x] Mark article read / archived
- [x] Resurfacing — real SM-2 spaced repetition (interval growth on recall,
      reset on a miss), not a heuristic. Digest generation persists and
      reuses a batch per the user's DAILY/WEEKLY frequency instead of
      re-rolling one on every visit; feedback ("remembered" / "forgot" /
      archive) updates the schedule. Digest emailing sends for real via
      Resend when configured, logs to the console otherwise
- [x] Local ↔ account sync — creating an account migrates existing local
      articles, highlights, and collections onto it instead of stranding them
- [x] API rate limiting, error monitoring (Sentry, no-op without a DSN)
- [x] Automated tests — unit (SM-2, highlight anchoring), integration (the
      full API surface via Fastify's `.inject()`), and e2e (Playwright: the
      local/anonymous IndexedDB path, real PDF/EPUB rendering and
      highlighting, and the browser extension loaded for real in Chromium)
      — see [Testing](#testing)
- [x] Browser extension (`apps/extension`) — log in, save the current page
      from the toolbar or a right-click menu. Real icon set, Firefox
      support (one manifest, both browsers) — see `apps/extension/README.md`
- [x] Mobile app (`apps/mobile`) — Expo/React Native, and actually running
      (web target, verified via Playwright against the real dev API — no
      simulator/device in this environment, see that app's README for
      exactly what is and isn't covered). Local-first like the web app
      (AsyncStorage instead of IndexedDB, same repository-pattern swap
      point), with highlighting (a toggled select-then-highlight flow --
      React Native has no single component that both reports a text
      selection and renders per-range styling, unlike a browser),
      collections, PDF/EPUB upload (as extracted text — no real page/CFI
      rendering, which needs DOM canvas/iframe APIs React Native doesn't
      have), and Daily Review/resurfacing with the same SM-2 feedback loop
- [x] Deployment configs — Dockerfiles for both apps, `docker-compose.yml`,
      `DEPLOYMENT.md`. Written carefully but not build-tested (no Docker in
      the environment that wrote them) — see `DEPLOYMENT.md` for exactly
      what is and isn't verified

## Testing

```bash
pnpm --filter @booklet/shared test      # unit: SM-2 algorithm, highlight-anchor resolution
pnpm --filter @booklet/api test         # integration: full API via Fastify .inject(), real dev DB
pnpm --filter @booklet/web test:e2e     # e2e: local/anonymous flow, real PDF + EPUB rendering and highlighting
pnpm --filter @booklet/extension test:e2e   # e2e: loads the real built extension in Chromium (headed -- see its README)
```

`apps/web/e2e` covers the local/anonymous save→read→highlight loop, the
real PDF (`pdf-reader.spec.ts`) and EPUB (`epub-reader.spec.ts`) readers
end to end (actual canvas rendering and iframe-based pagination in a real
browser, not mocked), and tags/search/reading-progress persistence
(`tags-search-progress.spec.ts`). `apps/mobile` has no automated test
suite (`tsc --noEmit` only); its web target was verified manually the same
way, see `apps/mobile/README.md`.

`.github/workflows/ci.yml` runs the shared/api/web suites (the API and web
e2e jobs against a real Postgres service container) plus typecheck/lint
for every package, and the extension's e2e suite under `xvfb` in its own
job — written and syntax-checked, not yet run for real (no CI runner in
the environment that wrote it).

## Roadmap

What's left is mostly things this environment genuinely cannot do (no
Apple/Google/Mozilla developer account, no Docker, no cloud account, no
device/simulator) rather than unstarted work:

- **Mobile app on a real device/simulator** — the web target runs and is
  verified; `ios`/`android` are type-checked only, since this environment
  has no Xcode/iOS Simulator or Android Studio/emulator. Eventually a real
  App Store / Play Store release, which needs developer accounts that
  don't exist here either
- **Browser extension store publishing** — Chrome Web Store and
  addons.mozilla.org both need developer accounts this environment doesn't
  have. Safari support needs Xcode's `safari-web-extension-converter`
  (macOS-only)
- **Real production deployment** — the Dockerfiles and `docker-compose.yml`
  exist and were reasoned through carefully, but have never actually been
  built (no Docker here) or deployed anywhere
- **CI actually running for real** — `.github/workflows/ci.yml` is
  syntax-checked but has never executed on a real GitHub Actions runner
- Smaller, not-yet-started polish: React Navigation for mobile once it has
  more than a handful of screens; real page/CFI rendering for mobile
  PDF/EPUB (needs a WebView bridge to reuse the web app's pdfjs-dist/
  epub.js code, or a native renderer — a real project of its own, not a
  scaffold-stage add-on); exports and sharing are intentionally out of
  scope until everything above is solid

See each app's own README (`apps/mobile`, `apps/extension`) for exactly
what's verified and what isn't within these constraints.

## Tech stack

| Layer | Choice |
| --- | --- |
| Monorepo | pnpm workspaces |
| API | Node.js, TypeScript, Fastify |
| Database | PostgreSQL via Prisma ORM (v7, driver adapters) |
| Web app | Next.js (App Router), TypeScript, Tailwind CSS v4 |
| Browser extension | Manifest V3, esbuild, no framework |
| Mobile | Expo / React Native |
| Article extraction | Mozilla Readability + jsdom (HTML), pdfjs-dist (PDF), jszip + jsdom (EPUB) |
| PDF/EPUB rendering | pdfjs-dist (canvas + text layer) and epub.js (paginated, CFI-anchored) in the browser -- real page/chapter rendering, not extracted text |
| Auth | Email/password, JWT access + refresh tokens (structured to swap in Clerk/Auth0 later without a rewrite); optional — only needed for sync |
| Local storage | IndexedDB (no-account mode is the default, not a fallback) |
| Email | Resend, with a console-log fallback when unconfigured |
| Error monitoring | Sentry (`@sentry/node` / `@sentry/browser`), no-op without a DSN |
| Testing | Vitest (unit + integration), Playwright (e2e) |
| Fonts | Literata (serif, reading) + Work Sans (sans, UI chrome) |

## Project structure

```
apps/
  api/            Fastify API + Prisma schema
  web/            Next.js web app
  extension/      Browser extension (Manifest V3)
  mobile/         Expo/React Native app
packages/
  shared/         Types and logic shared across apps
                  (request/response DTOs, highlight anchoring, SM-2 resurfacing)
docker-compose.yml, apps/*/Dockerfile, DEPLOYMENT.md
                  Deployment configs (see DEPLOYMENT.md for verification status)
.github/workflows/ci.yml
                  CI: typecheck/lint, unit + integration + e2e tests
```

## Getting started

Requires Node 22.13+ (pnpm 11's own minimum) and pnpm. You also need a
PostgreSQL database -- either a real one, or the bundled dev database (no
install required, see below).

```bash
pnpm install

cp apps/api/.env.example apps/api/.env        # fill in DATABASE_URL, JWT_ACCESS_SECRET, etc.
cp apps/web/.env.example apps/web/.env.local

pnpm dev:db    # local Postgres-compatible dev database (skip if using real Postgres)
pnpm dev:api   # Fastify API on :4000
pnpm dev:web   # Next.js app on :3000 (or the next free port)
```

The Prisma client regenerates automatically on install.

**Using a real Postgres:** point `DATABASE_URL` at it and run
`pnpm --filter @booklet/api exec prisma migrate deploy` (or `migrate dev`
while iterating on the schema).

**Using the bundled dev database:** `pnpm dev:db` starts a small
[PGlite](https://pglite.dev)-backed server that speaks the Postgres wire
protocol on `localhost:5432` and persists to `apps/api/.pglite-data/` --
useful for local development without installing Postgres or Docker. Prisma's
own migration engine doesn't talk to it reliably, so apply schema changes
with `pnpm --filter @booklet/api migrate:pglite` instead of `migrate dev`/
`migrate deploy` when using this database.

**Browser extension:** `pnpm --filter @booklet/extension build`, then load
`apps/extension/dist` as an unpacked extension in Chrome or Firefox. See
`apps/extension/README.md`.

**Mobile app:** `pnpm --filter @booklet/mobile web` (or `ios` / `android`
with the respective toolchain installed). The web target is verified end
to end; see `apps/mobile/README.md` for exactly what is and isn't.

**Deploying:** see `DEPLOYMENT.md`.

## License

Copyright © 2026 jguapp. All rights reserved.

This repository and its contents are proprietary and confidential. No part of
this codebase may be copied, modified, merged, published, distributed,
sublicensed, or used for any purpose without prior written permission from
the copyright holder.
