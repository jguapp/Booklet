import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@booklet/shared"],
  // Standalone output is what apps/web/Dockerfile's runtime stage expects --
  // a self-contained server bundle instead of needing the full node_modules
  // tree copied into the final image.
  output: "standalone",
  // Cross-origin isolation, scoped to just the reader routes -- lets
  // SharedArrayBuffer exist there, which onnxruntime-web's WASM backend
  // needs to run Kokoro TTS multi-threaded. Only takes effect on a real
  // (hard) navigation into a /reader/:id page (crossOriginIsolated is
  // fixed at initial-document-load time, not retroactive to a client-side
  // SPA transition) -- confirmed by hand this did NOT measurably speed up
  // generation regardless (still ~12-18s per sentence; the actual
  // bottleneck is this model's raw WASM inference cost, not thread count),
  // so nothing forces a hard navigation into the reader for this. Left in
  // place anyway since it's genuinely correct configuration and free for
  // the paths that do hard-navigate here (a bookmark, an external link, a
  // hard refresh) -- see kokoro-tts.ts. Deliberately NOT set globally:
  // COEP: require-corp blocks any cross-origin resource (image, iframe,
  // script) that doesn't itself send a matching CORP/CORS header, which
  // would risk breaking OAuth popup flows (COOP: same-origin can sever
  // window.opener postMessage) on pages that need them -- the reader
  // routes don't use OAuth or load live cross-origin resources (article
  // images are inlined as data: URIs at save time, EPUB content renders
  // from a local Blob), so this is safe to scope tightly here.
  async headers() {
    return [
      {
        // Covers both /reader/[id] and /reader/demo.
        source: "/reader/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
      {
        // Defence in depth behind sanitization, not instead of it.
        //
        // Article HTML is sanitized twice already -- once before storage and
        // once at render (see apps/web/src/lib/reader/sanitize.ts for why
        // both). This exists because that is exactly the kind of protection
        // that is one regression away from being absent, and the failure is
        // silent: nothing looks different on the page when a payload starts
        // getting through. A CSP turns "an attacker runs JS on your origin"
        // into "the browser refused to run it and said so in the console".
        //
        // 'unsafe-inline' and 'unsafe-eval' are present under protest.
        // Next.js's App Router injects inline bootstrap scripts and, in
        // development, relies on eval for hot reload; removing them needs
        // per-request nonces threaded through the framework, which is a real
        // change rather than a config line. They are the reason this is a
        // second line and not a first one -- an inline-script payload would
        // still run. What it *does* stop cold is the whole exfiltration half
        // of the attack: connect-src and img-src mean a payload that runs
        // cannot post the stolen token anywhere.
        //
        // frame-ancestors 'none' is the clickjacking control, and
        // object-src 'none' removes the plugin vector outright.
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              // data: is required -- extraction inlines article images as
              // data: URIs, which is the whole reason a saved article still
              // renders when the publisher's CDN is gone.
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              // blob: covers the EPUB reader, which renders book content from
              // a local Blob URL rather than a network fetch.
              "media-src 'self' data: blob:",
              "frame-src 'self' blob:",
              // The API origin is the only cross-origin destination the app
              // legitimately talks to.
              `connect-src 'self' ${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}`,
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
