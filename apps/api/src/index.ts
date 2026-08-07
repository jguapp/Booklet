import { buildApp } from "./app.js";
import { initTelemetry, shutdownTelemetry } from "./lib/telemetry.js";
import { warmTtsPool } from "./services/tts-pool.js";
import { warmEmbeddingModel } from "./services/embedding-service.js";

// .env loading happens via the "dev"/"start" scripts' own --env-file-if-
// exists flag (package.json), not here -- ES module static imports (both
// of the above, and everything they transitively import, including
// prisma.ts's module-scope `createPrismaClient()` call) are hoisted and
// fully evaluated *before* any of this file's own top-level statements
// run, so a call here happens too late for anything that reads
// process.env at import time. Confirmed by hand: this used to be exactly
// that call, in a try/catch -- it looked like it worked (PORT happened to
// already match its own hardcoded fallback either way) but DATABASE_URL
// was actually always undefined by the time PrismaPg's constructor ran,
// surfacing as a `SASL: ... client password must be a string` error on
// the first real query, not at startup. A CLI flag loads env vars before
// the process even begins evaluating module code at all, which is the
// only place in this pipeline that's actually early enough.

// Before anything serves a request, so the first one is already traced.
// Unlike auto-instrumentation this has no "must run before the instrumented
// module is imported" constraint -- every span in this app is created
// explicitly by our own code (see lib/telemetry.ts for why it's manual), and
// the tracer those call sites resolve is looked up per call, not captured at
// import time.
initTelemetry();

const app = await buildApp();
const port = Number(process.env.PORT ?? 4000);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

// Not awaited before listen() -- the server should start accepting
// connections immediately; TTS just lazily catches up on its own first
// real call if the pool hasn't finished warming by then. Only here (the
// real server entry point), not in buildApp() itself: buildApp() is what
// integration tests use via .inject(), and they should never spawn real
// child processes or trigger a real model download just from building an
// app instance.
warmTtsPool();

// Same shape as warmTtsPool above, and for the same reason: the ~25MB
// MiniLM download is a one-time cost that belongs at startup rather than
// inside whichever search request happens to be first. Not awaited, and it
// swallows its own failures -- semantic search is optional (the search route
// degrades to keyword-only), so it must never delay or block listen().
warmEmbeddingModel();

// Adding any listener for these signals replaces Node's default
// terminate-on-signal behavior, so once tts-pool.ts registers its own (to
// kill its worker processes) something has to actually end the process --
// this is that something, and it is deliberately the entry point rather than
// whichever module got imported first.
//
// Spans are exported in batches (see lib/telemetry.ts), so without flushing
// first the last few seconds are dropped, which are usually the interesting
// ones given something just caused the process to exit. The flush is async;
// exiting is what happens after it, however it goes.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdownTelemetry().finally(() => process.exit(0));
  });
}
