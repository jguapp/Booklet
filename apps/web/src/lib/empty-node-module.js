// Turbopack has no webpack-style `resolve.fallback: { fs: false }` -- aliasing
// to this empty module is the equivalent. Needed because
// @mintplex-labs/piper-tts-web's bundled Emscripten glue has a generic
// `if (ENVIRONMENT_IS_NODE) { require("fs"); require("path"); }` branch that
// never actually runs in a browser bundle, but Turbopack still needs `fs`/
// `path` to resolve to *something* at build time. See next.config.ts.
module.exports = {};
