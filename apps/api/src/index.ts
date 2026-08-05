import { buildApp } from "./app.js";
import { warmTtsPool } from "./services/tts-pool.js";

try {
  process.loadEnvFile();
} catch {
  // no .env file present -- fine in environments where real env vars are set directly
}

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
