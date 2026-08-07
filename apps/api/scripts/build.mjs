// Production build: bundles with esbuild instead of plain `tsc`.
//
// Why not tsc: apps/api's own source already uses Node-ESM-correct .js
// relative imports, and the Prisma-generated client does too now (see
// schema.prisma's importFileExtension) -- so tsc alone gets *those* right.
// What it can't fix is @booklet/shared: its package.json main points at raw
// .ts source (deliberately -- the web app's Next.js build consumes it the
// same way, see next.config.ts's transpilePackages), which plain `node`
// can't execute at all. Dev works anyway because tsx (esbuild-based) loads
// TypeScript transparently; `node dist/index.js` has no such thing, so
// @booklet/shared needs to actually be inlined at build time instead.
// Bundling the whole app the same way (rather than hand-rolling a fix just
// for that one package) keeps this correct for any future dependency with
// the same shape, not just this one.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));

// Real npm dependencies stay external (required from node_modules at
// runtime, exactly like today) -- notably this keeps @prisma/client and
// @prisma/adapter-pg untouched, so their own runtime query-engine lookup
// logic never has to survive being relocated into a bundle. Only
// @booklet/shared is deliberately excluded from this list: unlike
// everything else here, it's unbuilt workspace TypeScript, so it has to be
// inlined, not externalized.
//
// The corollary, and it has bitten once: importing a package that is only a
// *transitive* dependency leaves it un-externalized, so esbuild tries to
// bundle it. For a pure-JS package that merely bloats the output; for
// anything with a native binding it fails outright. Importing
// @huggingface/transformers directly (to configure the ONNX session, #162)
// pulled in onnxruntime-node and broke the Docker build with "No loader is
// configured for '.node' files" -- while `tsc --noEmit` was perfectly happy,
// because type-checking resolves through node_modules and never asks who
// declared what. The fix is to declare it as a real dependency, which is
// correct regardless: relying on a transitive is a break waiting for kokoro-js
// to change its own dependency list.
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => name !== "@booklet/shared");

const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external,
  sourcemap: true,
  logLevel: "info",
};

await build({ ...shared, entryPoints: ["src/index.ts"], outfile: "dist/index.js" });

// A second, standalone bundle -- tts-pool.ts forks this as its own OS
// process (see that file's own comment for why: a worker_thread crashes
// on onnxruntime-node's native binding). Deliberately built as its own
// entry point rather than left for index.ts's bundle to inline, and
// deliberately placed flat in dist/ (not nested under dist/services/) so
// tts-pool.ts can point at it with the same path expression in both dev
// (forks the TS source directly via tsx) and here.
await build({
  ...shared,
  entryPoints: ["src/services/tts-worker-process.ts"],
  outfile: "dist/tts-worker-process.js",
});
