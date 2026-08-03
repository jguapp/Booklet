import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@booklet/shared"],
  // Standalone output is what apps/web/Dockerfile's runtime stage expects --
  // a self-contained server bundle instead of needing the full node_modules
  // tree copied into the final image.
  output: "standalone",
  // Cross-origin isolation, scoped to just the reader routes -- required
  // for SharedArrayBuffer, which onnxruntime-web's WASM backend needs to
  // run Kokoro TTS multi-threaded. Without it (confirmed by hand:
  // window.crossOriginIsolated was false, SharedArrayBuffer undefined,
  // despite a 16-core machine), it silently falls back to single-threaded
  // WASM -- a large share of why TTS took 13+ seconds just to start
  // speaking. Deliberately NOT set globally: COEP: require-corp blocks any
  // cross-origin resource (image, iframe, script) that doesn't itself send
  // a matching CORP/CORS header, which would risk breaking OAuth popup
  // flows (COOP: same-origin can sever window.opener postMessage) on
  // pages that need them. The reader routes don't use OAuth or load live
  // cross-origin resources (article images are inlined as data: URIs at
  // save time, EPUB content renders from a local Blob), so this is safe
  // to scope tightly rather than applied app-wide.
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
