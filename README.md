<div align="center">
  <img src=".github/assets/banner.svg" alt="Booklet — save what you find, keep what you highlight" width="100%" />
</div>

<div align="center">

**A read-later app that assumes you actually want to remember what you read.**

Save anything. Read it beautifully. Highlight what matters — then get asked
about it later, before you're shown the answer.

</div>

<div align="center">

![License](https://img.shields.io/badge/license-proprietary-red?style=for-the-badge)
![Node](https://img.shields.io/badge/node-22.13%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-11-F69220?style=for-the-badge&logo=pnpm&logoColor=white)

![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next-black.svg?style=for-the-badge&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)
![Fastify](https://img.shields.io/badge/Fastify-000000?style=for-the-badge&logo=fastify&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/postgres-%23316192.svg?style=for-the-badge&logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=for-the-badge&logo=tailwind-css&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=for-the-badge&logo=playwright&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)
![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)

</div>

---

<div align="center">
  <img src=".github/assets/library.png" alt="The Booklet library: saved articles as clean cards, filtered by unread, reading and archived" width="100%" />
</div>

---

## The problem

Every read-later app has the same failure mode. Articles pile into a queue
nobody clears, and highlights — the actual reason most things get saved —
disappear into a list that never gets reopened.

The usual answer is a "resurfacing" feature that shows you an old highlight
and asks whether you remembered it. **That ordering is backwards.** You're
being asked to grade a recall attempt you were never given the chance to
make, and recognition feels like recall without being it.

Booklet fixes the second half of the problem specifically.

## What makes it different

### Reading that gets out of the way

Article extraction that keeps the text and throws away the furniture, in a
typographic frame designed for long-form. Four reading themes, adjustable
measure and size, and progress that survives a reload.

<div align="center">
  <img src=".github/assets/reader.png" alt="The reader: a clean article page with a yellow highlight over the opening sentence" width="100%" />
</div>

**PDF and EPUB are first-class**, not an afterthought — real page rendering
and real CFI-anchored highlights, not a text dump. Scanned PDFs go through
OCR automatically when there's no text layer to read.

### Highlights that anchor, and survive

Highlights are stored as **W3C-style text-quote and text-position
selectors**, so they re-anchor even when the underlying article changes
slightly. Each one knows where it came from — "p. 42" for a PDF, "Section 4"
for an EPUB, "Paragraph 7" for an article.

<div align="center">
  <img src=".github/assets/highlights.png" alt="The highlights dashboard, grouped by source article with citations" width="100%" />
</div>

### Review that's actually retrieval practice

Real **SM-2 spaced repetition** — the SuperMemo algorithm, not an
approximation of it. Every highlight carries its own easiness factor,
interval, and next-due date.

And the part that matters: a highlight can carry a **recall prompt**. When it
does, Daily Review asks the question and withholds *both the passage and the
grade buttons* until you've actually tried to answer.

<table>
<tr>
<td width="50%"><img src=".github/assets/daily-review-prompt.png" alt="Daily Review asking a question with the answer hidden behind a Show the highlight button" /></td>
<td width="50%"><img src=".github/assets/daily-review.png" alt="Daily Review showing a highlight with remembered, forgot and archive buttons" /></td>
</tr>
<tr>
<td align="center"><b>With a prompt</b> — question first, answer on demand</td>
<td align="center"><b>Without one</b> — unchanged, so nothing breaks</td>
</tr>
</table>

### Listen to anything, with no API bill

Local neural text-to-speech via **Kokoro-82M**, running on your own CPU. 54
voices, word-level read-along highlighting, and a two-tier cache so a
re-listen is instant.

It also publishes your queue as a **private podcast feed**, so your reading
list shows up in whatever player already has your lock-screen controls,
CarPlay, and sleep timer.

### Works signed out, forever

The whole app runs against IndexedDB with no account at all. Accounts exist
**only** for sync — and when you make one, your local library migrates up
in batches, resumable, with every field carried across.

<div align="center">
  <img src=".github/assets/settings.png" alt="Settings, showing reading preferences and sync options" width="100%" />
</div>

### And the rest

**Share** a collection's highlights on a public, unlisted page that reveals
nothing else about your account · **Search** across titles, text and notes ·
**Collections**, nested and smart · **RSS** subscriptions · **Import** from
Pocket, Instapaper, browser bookmarks and Kindle `My Clippings.txt` ·
**Export** to Markdown for Obsidian · a **browser extension** for Chrome and
Firefox · a **public API** with personal access tokens and webhooks · and a
**React Native** app.

---

## Architecture

Four clients, one API, one shared vocabulary package.

```mermaid
graph TB
    subgraph Clients
        WEB["🌐 Next.js web app<br/><i>reader, highlights, review</i>"]
        EXT["🧩 Browser extension<br/><i>Chrome + Firefox</i>"]
        MOB["📱 React Native<br/><i>Expo</i>"]
        POD["🎧 Any podcast client<br/><i>RSS + enclosures</i>"]
    end

    subgraph API["Fastify API"]
        ROUTES["16 route modules<br/><i>REST + versioned /api/v1</i>"]
        SVC["Services<br/><i>extraction · TTS · OCR · aggregation</i>"]
    end

    subgraph Data
        PG[("PostgreSQL<br/><i>19 models via Prisma</i>")]
        REDIS[("Redis<br/><i>optional L2 audio cache</i>")]
        DISK[("Disk<br/><i>uploads + episodes</i>")]
    end

    subgraph Local["On-device"]
        IDB[("IndexedDB<br/><i>full app, no account</i>")]
    end

    WEB <--> IDB
    WEB --> ROUTES
    EXT --> ROUTES
    MOB --> ROUTES
    POD --> ROUTES
    ROUTES --> SVC
    SVC --> PG
    SVC --> REDIS
    SVC --> DISK

    style WEB fill:#1d5570,color:#fff
    style API fill:#2d6a4f,color:#fff
    style Local fill:#8e5c0c,color:#fff
```

### The offline-first seam

This is the design decision everything else follows from. Every domain has
one module in `apps/web/src/lib/data/` that branches on whether you're
signed in — and that branch is the *only* place the difference exists.

```mermaid
flowchart LR
    UI["Reader / Library / Review<br/><i>never knows which mode</i>"]
    SWAP{{"lib/data/*.ts<br/><b>the swap point</b>"}}
    LOCAL[("IndexedDB<br/>local mode")]
    API["apiFetch → Fastify<br/>synced mode"]

    UI --> SWAP
    SWAP -->|"authenticated: false"| LOCAL
    SWAP -->|"authenticated: true"| API

    style SWAP fill:#8e5c0c,color:#fff
    style UI fill:#1d5570,color:#fff
```

Signing up runs a **batched, resumable migration**: local data goes up ~4 MB
at a time, each batch is cleared only after the server accepts it, and
uploaded files follow in a second phase keyed by the ids the server just
minted. A dropped connection resumes rather than restarting — and rather
than silently emptying your library, which is what an earlier version did.

### Saving an article

```mermaid
sequenceDiagram
    participant U as You
    participant W as Web app
    participant A as API
    participant S as Site

    U->>W: Paste a URL
    W->>A: POST /api/extract
    A->>A: Reject private/reserved addresses (SSRF guard)
    A->>S: Fetch
    S-->>A: HTML
    A->>A: Readability → article text
    A->>A: Inline images as data: URIs
    A->>A: Sanitize (allowlist — Readability is not a sanitizer)
    A-->>W: Clean article
    W->>W: Store (IndexedDB or POST /api/articles)
    W-->>U: Ready to read, offline, forever
```

Images are inlined at save time, so a saved article still renders years
later when the publisher's CDN is gone. Which is the point — [the web is not
an archive](#the-problem).

### Read-aloud, and why it's fast

The engineering story worth telling. Kokoro runs at roughly 1–2× realtime on
CPU, so generating a whole article before playback would mean waiting
minutes. Instead:

```mermaid
flowchart LR
    T["Article text"] --> C["Chunker<br/><i>first chunk ≤ 80 chars</i>"]
    C --> Q{{"Cache?"}}
    Q -->|"L1 hit"| P["▶ Play"]
    Q -->|"L2 hit (Redis)"| P
    Q -->|"miss"| POOL["Worker pool<br/><i>forked processes</i>"]
    POOL --> P
    P -.->|"while playing"| AHEAD["Generate ahead"]
    AHEAD --> POOL

    style P fill:#2d6a4f,color:#fff
    style POOL fill:#1d5570,color:#fff
```

A deliberately tiny first chunk means audio starts in about a second; the
rest is generated during playback and cached, so the second listen is
instant. Workers are **forked processes rather than worker threads** —
onnxruntime's native binding crashes in threads — with their ONNX thread
budget divided by pool size so three workers don't each try to use every
core.

---

## Status

**Feature-complete and not yet deployed.** Everything above works and is
tested. What remains is a front-end visual redesign and the deployment
itself.

| | |
|---|---|
| **Source files** | 349 TypeScript across 4 apps + 1 shared package |
| **Data model** | 21 Prisma models, 24 migrations |
| **Tests** | Unit (Vitest) in `packages/shared`, `apps/web` and `apps/api`; 50 Playwright e2e specs |
| **One command** | `pnpm verify` runs 10 checks and tells you what it *didn't* |

This repo documents its own mistakes on purpose — in commit messages and in
comments that explain not just how something works but what was tried,
rejected, and reversed, including the bugs that shipped and how they were
found.

**Known and written down:** the Docker volume behaviour needs one real
`docker compose` run to verify, the podcast feed has never been subscribed to
in a real client, and the read-along drift measurement needs a machine with
network access. Each is tracked with the exact command that closes it.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript, strict, everywhere | One vocabulary across API, web, mobile, extension |
| API | Fastify 5 | Fast, schema-first, good plugin story |
| Database | PostgreSQL + Prisma 7 | Typed queries, real migrations |
| Web | Next.js 16 (App Router) + React 19 | Server components where they help |
| Styling | Tailwind v4 | Utility-first, no CSS-in-JS runtime |
| Local storage | IndexedDB | Transactional, structured, actually offline |
| TTS | Kokoro-82M via `kokoro-js` + onnxruntime | 82M params, runs on CPU, no API bill |
| Extraction | `@mozilla/readability` + jsdom | The same engine Firefox Reader View uses |
| PDF / EPUB | pdf.js · epub.js · Tesseract.js | Real rendering, real OCR fallback |
| Testing | Vitest + Playwright | Fast unit, real browser e2e |
| Monorepo | pnpm workspaces + Turborepo | Caching, filtered runs |

## Project structure

```
apps/
  api/         Fastify · Prisma · extraction · TTS pool · OCR
  web/         Next.js app — reader, highlights, review, sharing
  mobile/      React Native (Expo)
  extension/   Chrome + Firefox, MV3
packages/
  shared/      Types, SM-2, chunking, anchoring — the shared vocabulary
```

## Getting started

Requires Node 22.13+ and pnpm 11.

```bash
pnpm install

cp apps/api/.env.example apps/api/.env        # DATABASE_URL, JWT_ACCESS_SECRET, …
cp apps/web/.env.example apps/web/.env.local

pnpm dev:db    # bundled Postgres-compatible dev database (skip if you have real Postgres)
pnpm dev:api   # Fastify on :4000
pnpm dev:web   # Next.js on :3000
```

No Postgres install needed for local dev: `pnpm dev:db` starts a
[PGlite](https://pglite.dev)-backed server speaking the Postgres wire
protocol, persisting to `apps/api/.pglite-data/`. Apply schema changes with
`pnpm --filter @booklet/api migrate:pglite` when using it — Prisma's own
migration engine doesn't talk to PGlite reliably.

With a real Postgres, point `DATABASE_URL` at it and run
`pnpm --filter @booklet/api exec prisma migrate deploy`.

**Verify everything:**

```bash
pnpm verify          # 10 checks: builds, 4 typechecks, lint, prod bundle, 3 unit suites
pnpm verify --e2e    # …plus the browser suite (prints the env it needs)
```

`pnpm verify` deliberately reports what it **skipped** and what it cannot
cover anywhere, because a green summary that quietly skipped half the checks
is worse than a red one.

**Browser extension:** `pnpm --filter @booklet/extension build`, then load
`apps/extension/dist` unpacked. See `apps/extension/README.md`.

**Mobile:** `pnpm --filter @booklet/mobile web` (or `ios` / `android`). See
`apps/mobile/README.md` for what is and isn't verified.

**Deploying:** `DEPLOYMENT.md`.

## License

Copyright © 2026 jguapp. All rights reserved.

This repository and its contents are proprietary and confidential. No part of
this codebase may be copied, modified, merged, published, distributed,
sublicensed, or used for any purpose without prior written permission from
the copyright holder.
