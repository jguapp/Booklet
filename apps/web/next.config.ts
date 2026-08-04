import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@booklet/shared"],
  // piper-tts-web's bundled Emscripten glue has a generic
  // `if (ENVIRONMENT_IS_NODE) { require("fs"); require("path"); }` branch
  // that never actually runs in a browser bundle, but Turbopack (the default
  // for both `next dev` and `next build` as of Next 16 -- there is no
  // webpack-config equivalent to fall back to) still needs `fs`/`path` to
  // resolve to *something* at build time. Confirmed by hand: without this,
  // Turbopack hard-fails with "Module not found: Can't resolve 'fs'" the
  // moment anything imports piper-tts-web, even though that code path is
  // dead. See src/lib/empty-node-module.js.
  turbopack: {
    resolveAlias: {
      // Scoped to the "browser" condition only -- an unconditional alias
      // hijacks every `require("path")` project-wide, including Next's own
      // server-side internals (confirmed by hand: that broke SSR entirely,
      // "_path.default.parse is not a function", since Next's real `path`
      // usage got redirected to this empty stub too).
      fs: { browser: "./src/lib/empty-node-module.js" },
      path: { browser: "./src/lib/empty-node-module.js" },
    },
  },
  // Standalone output is what apps/web/Dockerfile's runtime stage expects --
  // a self-contained server bundle instead of needing the full node_modules
  // tree copied into the final image.
  output: "standalone",
  // Cross-origin isolation, scoped to just the reader routes -- lets
  // SharedArrayBuffer exist there, which onnxruntime-web's WASM backend
  // uses for multi-threading when generating Piper TTS audio. Only takes
  // effect on a real (hard) navigation into a /reader/:id page
  // (crossOriginIsolated is fixed at initial-document-load time, not
  // retroactive to a client-side SPA transition), so nothing forces a hard
  // navigation into the reader just for this -- it's free on the paths that
  // do hard-navigate here (a bookmark, an external link, a hard refresh).
  // Deliberately NOT set globally:
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
