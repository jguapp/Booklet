// piper-tts-web (via onnxruntime-web) needs its WASM runtime served from
// this app's own origin, not the version-mismatched CDN URL it hardcodes by
// default (see the onnxWasm override in src/lib/reader/piper-tts.ts).
// node_modules/onnxruntime-web is the single source of truth for these
// files -- copied here rather than committed to git so they never drift
// from whatever version is actually installed. Re-run automatically via
// postinstall; safe to run repeatedly (skips work once the manifest already
// matches the installed version).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const webDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const destDir = path.join(webDir, "public", "onnx-runtime");
const manifestPath = path.join(destDir, ".source-version");

// Can't require("onnxruntime-web/package.json") directly -- its own
// "exports" field doesn't list that subpath. Resolve the real entry file
// instead and walk up to the package root (the first ancestor directory
// literally named "onnxruntime-web", robust to pnpm's nested store layout).
let onnxPkgRoot = path.dirname(require.resolve("onnxruntime-web"));
while (path.basename(onnxPkgRoot) !== "onnxruntime-web") {
  const parent = path.dirname(onnxPkgRoot);
  if (parent === onnxPkgRoot) throw new Error("Could not locate the onnxruntime-web package root");
  onnxPkgRoot = parent;
}
const onnxPkg = JSON.parse(await readFile(path.join(onnxPkgRoot, "package.json"), "utf-8"));

if (existsSync(manifestPath) && (await readFile(manifestPath, "utf-8")) === onnxPkg.version) {
  process.exit(0);
}

// The only WASM backend files this onnxruntime-web version ships (confirmed:
// no separate non-threaded build -- the threaded build's own internal
// single-thread fallback covers browsers/contexts without
// crossOriginIsolated, which is what "WebAssembly multi-threading is not
// supported... Falling back to single-threading" in the console is).
const FILES = [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
];

await mkdir(destDir, { recursive: true });
await Promise.all(FILES.map((f) => copyFile(path.join(onnxPkgRoot, "dist", f), path.join(destDir, f))));
await writeFile(manifestPath, onnxPkg.version);

console.log(`[copy-onnx-wasm] copied onnxruntime-web ${onnxPkg.version} WASM runtime to public/onnx-runtime/`);
