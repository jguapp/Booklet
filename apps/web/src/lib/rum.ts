/**
 * Datadog RUM -- real-user performance, alongside Sentry (which stays, and
 * handles errors). The specific thing this is here to answer: what is TTFA
 * for actual readers on actual connections?
 *
 * Every read-aloud latency number so far has come from a local run or the CI
 * benchmark (apps/api/scripts/bench-tts-ttfa.ts), and neither is a user. The
 * benchmark in particular never pays a CORS preflight, real transfer time, or
 * audio-element decode, and runs on a 2-vCPU runner that resembles nobody's
 * laptop. tts-metrics.ts already measures the real thing in the browser; it
 * just had nowhere to send it.
 *
 * No-op without NEXT_PUBLIC_DD_RUM_APPLICATION_ID and
 * NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN, matching how NEXT_PUBLIC_SENTRY_DSN
 * already behaves -- absent means off, never an error, so nothing here is
 * needed to run the app locally or in CI.
 *
 * The client token is a publishable, write-only credential (that is what
 * distinguishes it from a DD_API_KEY, which must never reach a browser) --
 * NEXT_PUBLIC_ is correct for it, and only for it.
 */
import type { TtfaSample } from "./reader/tts-metrics";

let initialized = false;

function config(): { applicationId: string; clientToken: string } | null {
  const applicationId = process.env.NEXT_PUBLIC_DD_RUM_APPLICATION_ID;
  const clientToken = process.env.NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN;
  if (!applicationId || !clientToken) return null;
  return { applicationId, clientToken };
}

export async function initRum(): Promise<void> {
  if (initialized) return;
  const settings = config();
  if (!settings) return;
  initialized = true;

  // Imported dynamically so the SDK is only fetched by deployments that
  // actually have RUM configured -- a static import would put it in the main
  // bundle for everyone, including local development, which is a real cost
  // paid for a feature that is off.
  const { datadogRum } = await import("@datadog/browser-rum");
  datadogRum.init({
    ...settings,
    site: process.env.NEXT_PUBLIC_DD_SITE || "datadoghq.com",
    service: "booklet-web",
    env: process.env.NODE_ENV ?? "development",
    sessionSampleRate: 100,
    // No session replay: it records the page, and the page is whatever the
    // reader is reading. Not worth the privacy exposure for a latency metric.
    sessionReplaySampleRate: 0,
    defaultPrivacyLevel: "mask",
    // Lets RUM correlate a slow request with the API's own trace for it, and
    // is what makes the Server-Timing work on /api/tts reachable from the
    // same view as the TTFA numbers below.
    allowedTracingUrls: [(url: string) => url.startsWith(process.env.NEXT_PUBLIC_API_URL ?? "")],
  });
}

/**
 * Reports one completed TTFA measurement (see reader/tts-metrics.ts).
 *
 * `prewarm_hit` is a tag rather than part of the value because warm and cold
 * are genuinely different populations -- averaged together they produce a
 * number that describes neither, and the whole point of the warming work was
 * to move readers from one group into the other. Split, the metric shows both
 * the improvement and how often it applies.
 */
export function reportTtfa(sample: TtfaSample): void {
  if (!initialized) return;
  void import("@datadog/browser-rum").then(({ datadogRum }) => {
    datadogRum.addAction("tts.ttfa", {
      ttfa_ms: sample.ttfaMs,
      blob_ms: sample.blobMs,
      decode_ms: sample.decodeMs,
      bytes: sample.bytes,
      prewarm_hit: sample.prewarmHit,
    });
  });
}
