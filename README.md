# Booklet

Booklet is a read-it-later and annotation app for people who save more than
they read. Save an article, read it in a clean distraction-free view,
highlight and annotate as you go, and have those highlights resurface later
instead of disappearing into a list you never reopen.

**This is proprietary software.** Booklet is not open source. No license is
granted for use, modification, or redistribution of any part of this
repository — see [License](#license).

## Status

Booklet is early and under active development. Phase 1 (this repo, today) is
a web app + API + core data model, built one screen at a time:

- [x] Monorepo scaffold — Fastify API, Next.js web app, shared types package,
      end-to-end "hello world"
- [x] Core data model — Prisma schema for User, Article, Highlight,
      Annotation, and Collection (drafted and reviewed; not yet migrated to a
      live database)
- [x] Visual identity — type pairing, three-theme color system (Paper / Night
      / Lamp), spacing scale
- [x] Reader view — light/dark/sepia theming, adjustable type size,
      select-to-highlight with optional notes, drift-tolerant highlight
      re-anchoring (built against mock data; not yet wired to a real API)
- [ ] Auth (sign up / log in / log out)
- [ ] Save article by URL (server-side fetch + Readability extraction)
- [ ] Reading list / library view
- [ ] Highlights dashboard
- [ ] Mark article read / archived

## Roadmap

Where this is headed after Phase 1:

- **Browser extension** — save whatever page you're on, reusing the same
  extraction service and API as the web app
- **Mobile app** — the goal is a real iOS/Android release on the App Store,
  reusing the same API and data model rather than a rewrite
- **Spaced-repetition resurfacing** — the point of highlighting something is
  to see it again later; `Highlight` already tracks per-highlight surface
  history so this can be added without a data model change
- **PDF / EPUB support** — `Article.sourceType` is already reserved for this
- Exports, sharing, and other later-stage features are intentionally out of
  scope until the core loop (save → read → highlight → resurface) is solid

## Tech stack

| Layer | Choice |
| --- | --- |
| Monorepo | pnpm workspaces |
| API | Node.js, TypeScript, Fastify |
| Database | PostgreSQL via Prisma ORM (v7, driver adapters) |
| Web app | Next.js (App Router), TypeScript, Tailwind CSS v4 |
| Article extraction | Mozilla Readability + jsdom |
| Auth | Email/password, JWT access + refresh tokens (structured to swap in Clerk/Auth0 later without a rewrite) |
| Fonts | Literata (serif, reading) + Work Sans (sans, UI chrome) |

## Project structure

```
apps/
  api/            Fastify API + Prisma schema
  web/            Next.js web app
packages/
  shared/         Types and logic shared between api and web
                  (request/response DTOs, highlight anchoring algorithm)
```

## Getting started

Requires Node 20+ and pnpm. You also need a PostgreSQL database -- either a
real one, or the bundled dev database (no install required, see below).

```bash
pnpm install

cp apps/api/.env.example apps/api/.env        # fill in DATABASE_URL, etc.
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

## License

Copyright © 2026 jguapp. All rights reserved.

This repository and its contents are proprietary and confidential. No part of
this codebase may be copied, modified, merged, published, distributed,
sublicensed, or used for any purpose without prior written permission from
the copyright holder.
