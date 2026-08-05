import { buildApp } from "./app.js";
import { warmTtsModel } from "./services/tts-service.js";

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

// Fire-and-forget, not awaited before listen() -- the server should start
// accepting connections immediately; TTS just lazily loads on its own
// first real call if this hasn't finished yet by then. Only here (the real
// server entry point), not in buildApp() itself: buildApp() is what
// integration tests use via .inject(), and they should never trigger a
// real multi-second model download just from building an app instance.
void warmTtsModel();
