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
- [x] Save PDF/EPUB — server-side (signed in) or client-side via the same
      extraction endpoint (signed out, PDF only — see Roadmap for why EPUB
      needs an account for now). Renders as extracted text through the same
      highlighter as HTML articles, not the original page/CFI layout
- [x] Reading list / library view — IndexedDB-backed when signed out, synced
      via the API when signed in, same UI either way. Delete, archive, and
      organize into collections (folders) in both modes
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
      full API surface via Fastify's `.inject()`), and e2e (Playwright,
      exercising the local/anonymous IndexedDB path in a real browser) — see
      [Testing](#testing)
- [x] Browser extension (`apps/extension`) — log in, save the current page
      from the toolbar or a right-click menu
- [~] Mobile app (`apps/mobile`) — Expo/React Native scaffold: login,
      library, read-only article view. Type-checks clean; hasn't run on a
      device or simulator yet — see `apps/mobile/README.md`
- [x] Deployment configs — Dockerfiles for both apps, `docker-compose.yml`,
      `DEPLOYMENT.md`. Written carefully but not build-tested (no Docker in
      the environment that wrote them) — see `DEPLOYMENT.md` for exactly
      what is and isn't verified

## Testing

```bash
pnpm --filter @booklet/shared test    # unit: SM-2 algorithm, highlight-anchor resolution
pnpm --filter @booklet/api test       # integration: full API via Fastify .inject(), real dev DB
pnpm --filter @booklet/web test:e2e   # e2e: Playwright, needs the web + api dev servers running
```

`.github/workflows/ci.yml` runs all three (the API and e2e jobs against a
real Postgres service container) on push/PR — written and syntax-checked,
not yet run for real (no CI runner in the environment that wrote it).

## Roadmap

- **Full PDF/EPUB rendering** — today's PDF/EPUB support extracts and
  highlights text, not the original page layout; `HighlightPosition`'s
  `pdf` (page + rects) and `epub` (CFI) variants are already reserved in
  the schema for whenever real page/CFI rendering is worth building
- **EPUB support for local/anonymous mode** — works today only for signed-in
  users (server-side extraction via jsdom); local mode would need a
  client-side EPUB parser, not implemented yet
- **Mobile app**: get it running on a device/simulator, add highlighting
  (needs a React-Native-native text-selection approach, not a port of the
  web app's browser Selection/Range-based one), local-first parity, and
  eventually a real App Store / Play Store release — needs developer
  accounts that don't exist yet
- **Browser extension**: Chrome Web Store publishing (needs a developer
  account), a real icon set, Firefox/Safari support
- **Real production deployment**: the Dockerfiles and `docker-compose.yml`
  exist but have never actually been deployed anywhere
- Exports, sharing, and other later-stage features are intentionally out of
  scope until all of the above is solid

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

Requires Node 20+ and pnpm. You also need a PostgreSQL database -- either a
real one, or the bundled dev database (no install required, see below).

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
`apps/extension/dist` as an unpacked extension. See `apps/extension/README.md`.

**Mobile app:** `pnpm --filter @booklet/mobile web` (or `ios` / `android`
with the respective toolchain installed). See `apps/mobile/README.md` for
what's verified and what isn't.

**Deploying:** see `DEPLOYMENT.md`.

## License

Copyright © 2026 jguapp. All rights reserved.

This repository and its contents are proprietary and confidential. No part of
this codebase may be copied, modified, merged, published, distributed,
sublicensed, or used for any purpose without prior written permission from
the copyright holder.
