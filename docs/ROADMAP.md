# Post-deployment roadmap

Everything here is for **after** Booklet is live and has real users. Nothing
in this file should be started before then, and the ordering assumes it
isn't.

That constraint is the whole point of the document. Every feature decision
made so far has been made without a single piece of usage data — the
backlog is a set of well-reasoned guesses, and some of them are wrong in
ways nobody can currently tell. The observability work from #151 is built
and has nothing to observe. So the first job of this roadmap is to make
itself obsolete: replace guesses with observations, then re-cut it.

Read it as a sequence of **gates**, not a schedule. Each phase exists to
answer a question, and the next phase's content depends on the answer.

---

## Phase 0 — Watch. Do not build.

**Duration: the first two weeks live. Ship nothing that isn't a fix.**

The strong temptation on day one is to keep building, because building is
the habit. Resist it. The single most valuable thing that happens in the
first two weeks is that the guesses get graded, and that only works if the
thing being observed holds still.

What to actually do:

- **Watch the traces.** #151 wired OpenTelemetry with TTS queue-wait and
  generation as separate spans, cache tier as `l1`/`l2`/`miss`, and a real
  TTFA metric from RUM. All of that has been reasoned about and none of it
  has been *seen*. The 2.86× pool concurrency figure came from a 2-vCPU CI
  runner, which resembles nobody's laptop and no production host either.
- **Watch what people actually save.** The extraction pipeline was tuned
  against Wikipedia and a handful of fixtures. Real URLs are messier:
  paywalls, cookie walls, single-page apps, newsletters, PDFs that are
  actually scans.
- **Watch where they stop.** The funnel that matters isn't signup, it's
  *save → read → highlight → return*. Reading apps die at the last step.

**Questions Phase 0 must answer, because the rest of this document branches
on them:**

1. Is read-aloud used at all? It has consumed more engineering than any
   other feature. If TTFA is fine and usage is near zero, that reprioritises
   a lot.
2. Does anyone reach the second review session? Resurfacing is the
   retention thesis. One session is curiosity; the second is a habit.
3. What fraction of saves fail extraction, and why?
4. Does anyone use local/anonymous mode past the first session — and if
   they sign up, does the migration hold up on real libraries rather than
   test ones?

---

## Phase 1 — Fix what the first users hit

**Gate: Phase 0's data exists.**

This phase is deliberately not specified in detail, because specifying it
now would be the exact mistake this document is arguing against. It will be
mostly small, unglamorous corrections to things that looked fine in testing.

Two things are near-certain to land here regardless:

- **Extraction failures on real-world URLs.** Expect a long tail. The
  triage that matters is: is this site worth a special case, or is the
  generic path wrong?
- **Whatever the migration does on a large real library.** #164, #171, the
  `canonicalUrl` bug and #172 were all found at that seam, all silent, all
  after it was believed correct. A fifth is more likely than not.

Carry-over from the current backlog that belongs here rather than earlier:

- **#173's Docker volume verification.** Implemented and tested, but the
  acceptance criterion needs a real `docker compose down && up --build` with
  an upload on either side. Do this *before* Phase 0, not during it — it is
  a launch prerequisite, listed here only so it isn't lost.
- **Filling in the legal-page placeholders** (#174). The pages are a
  scaffold with visibly marked blanks. One of them genuinely needs a lawyer.

---

## Phase 2 — Make the retention thesis real

**Gate: question 2 above is answered "yes, some people come back."** If it's
answered "no", skip this entire phase and go to Phase 3 — the product is
then a reader, not a memory tool, and should be developed as one.

The app's argument is that reading is worth more when you retain it. #157
turned resurfacing into genuine retrieval practice by asking a question
before showing the answer. This phase builds on that, in dependency order:

1. **Finish #159.** The forced-alignment question is currently *open with a
   negative result*: two independent timing models disagree by 150–1340ms
   against a 100ms threshold, so the cheap check failed to rule it out. The
   ground-truth harness exists and has never been executed. One run on a
   networked machine either closes this permanently or justifies real work.
   Cheap, and it unblocks click-to-seek either way.
2. **Finer SM-2 grades.** Deliberately deferred in #157 and correctly so —
   grading a re-read on a five-point scale is false precision on a
   measurement that was already wrong. With prompts in place, there is
   finally a real retrieval attempt to grade. Do this *after* Phase 0
   confirms people review at all.
3. **Generated recall prompts.** The obvious follow-up to #157 and a
   genuinely good fit for a paid tier: turning a passage into a good
   question is what an LLM is actually useful for, and unlike summarisation
   it produces something the scheduler consumes directly. Gate it on manual
   prompts being used — if nobody writes one by hand, generating them
   automatically is solving the wrong problem.

---

## Phase 3 — Distribution

**Gate: the core loop retains someone.** Growth before retention just fills
a leaking bucket faster.

- **#158 Part 2 becomes real.** The cross-user aggregate ships with a
  threshold of 3 distinct accounts and currently has zero users, so new
  accounts see only the 19 public-domain seeds. The machinery compounds by
  itself as the user base grows — revisit the threshold upward, not
  downward, once there is data.
- **Publish the extension** (#7 Chrome, #8 Firefox, #9 Safari). The
  extension is the single strongest acquisition channel a read-later app
  has, because it inserts itself into the moment of intent. #9 in
  particular is worth doing properly rather than last, since Safari users
  have the fewest alternatives.
- **Measure whether share pages actually bring anyone back.** Every shared
  page is a link back; that was the argument for #158 Part 1. If the answer
  is no after a reasonable sample, stop investing in it.

---

## Phase 4 — Platform breadth

**Gate: web is stable and someone has asked for this.**

Mobile is the largest single lever and the largest single cost. It is
currently a real Expo app that mirrors the web data layer **by hand**, with
no enforced parity — a field added to `Highlight` has to be remembered in
four places, and nothing fails if it isn't.

- **#1/#2 — verify the builds on real hardware first.** Neither has ever
  run on a device or simulator. Everything below is speculative until this
  is done, and it is cheap.
- **#4 — real page/CFI rendering for PDF and EPUB.** Mobile currently shows
  extracted text only, which means highlights anchored on mobile and
  highlights anchored on web are not the same object. This is the real gap.
- **#3 — React Navigation**, once the screen count justifies it. Not before.
- **#5/#6 — the app stores.** Real money, real review cycles, real ongoing
  obligation. Do not start until #4 is done; shipping a reader that can't
  render the books people uploaded is worse than not shipping.

**Before any of this, decide the parity question**: either enforce
web/mobile data-layer parity mechanically (shared module, or a test that
fails when they diverge), or accept the drift explicitly and write down
that mobile is a subset. The current state — parallel by hand, undeclared —
is the one that produces silent bugs.

---

## Ongoing — scales with users, not with features

Not a phase. These become urgent at thresholds rather than dates.

| Trigger | Work |
|---|---|
| **A second API instance** | Object storage. `FILE_STORAGE_PATH` works completely for one instance and breaks at two — instance A cannot serve what instance B wrote (#173). This is the hard ceiling on horizontal scaling. |
| **A second API instance** | The rate limiter is in-memory and per-process; behind a load balancer it reads "N per instance". Move it to the Redis that already exists. |
| **A second API instance** | The per-account login delay is on the `User` row and so already shared — but re-check the TTS in-flight de-duplication, which is per-process. |
| **Any real traffic** | Database backups. `docker-compose.yml` says plainly it has none. Nothing else on this list matters if this one is missed. |
| **Podcast feed adoption** | WAV is ~2.9 MB/minute. #153's Opus work stops being a nice-to-have the moment anyone subscribes on cellular. |
| **Enough users to matter** | Per-account login limiting is in place; revisit whether the per-IP ceiling of 100/15min is still right, and whether `PublicHighlightStat`'s threshold of 3 should rise. |
| **Growing library sizes** | Search is `contains` matching, chosen deliberately so signed-in and local mode behave identically. That trade gets worse with library size, not with user count. |

---

## Things deliberately NOT on this roadmap

Recorded so they aren't rediscovered as ideas.

- **Scraped third-party highlights** (Amazon/Kindle popular highlights). A
  ToS and copyright grey area. #158 rules it out permanently; the
  network-effect aggregate is the legitimate version and it is built.
- **Social features beyond sharing.** Following, feeds, comments. A reading
  app that becomes a social network stops being a reading app, and the
  retention thesis here is personal, not social.
- **Real-time collaboration.** No evidence anyone wants to co-highlight.
- **A second CI config.** There are already two and at most one is live.
  Consolidate before adding anything (see `DEPLOYMENT.md`, "Which CI config
  is live").
