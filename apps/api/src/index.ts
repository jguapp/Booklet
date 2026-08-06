import { buildApp } from "./app.js";
import { warmTtsPool } from "./services/tts-pool.js";

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
