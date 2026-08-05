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
    ];
  },
};

export default nextConfig;
