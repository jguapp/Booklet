/**
 * A stand-in TTS worker that loads fine and then never answers a generation
 * request, used by tts-pool-failure.test.ts to hold a request in flight.
 *
 * Kokoro generation is measured in seconds, so "a request was mid-generation
 * when something happened to the pool" is the ordinary case rather than a
 * narrow one. This just makes it hold still.
 */
process.send?.({ type: "ready", ok: true });

process.on("message", () => {
  // Deliberately no reply: the request stays in the pool's `inFlight` map.
});

setInterval(() => {}, 1 << 30);
