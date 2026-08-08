/**
 * Bundles the semantic-search worker (#156) into public/workers/ with esbuild.
 *
 * Next is not doing this, and that is the whole reason this script exists.
 * Turbopack does not compile a first-party TypeScript worker referenced by
 * `new Worker(new URL("./embedding-worker.ts", import.meta.url))` -- it treats
 * the file as a static asset and copies the TypeScript source into
 * .next/static/media verbatim. The build succeeds, the URL resolves, and the
 * browser then fails to parse it, which is exactly the kind of "green build,
 * broken feature" that is worth a build step to avoid. Verified against Next
 * 16.2.11 with and without `{ type: "module" }`, and with the module marked
 * "use client"; the emitted artifact was raw .ts every time.
 *
 * Bundling it separately has a second, larger payoff. Left in Next's module
 * graph, @huggingface/transformers and onnxruntime-web ended up in a shared
 * client chunk -- megabytes of WASM glue shipped to every visitor, including
 * everyone who never turns semantic search on. Out here it is one file that is
 * only ever fetched when a Worker is actually constructed.
 *
 * The output is generated, not committed: see public/workers/.gitignore.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "../src/lib/search/embedding-worker.ts");
const outfile = resolve(here, "../public/workers/embedding-worker.js");

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  // A module worker, matching the `{ type: "module" }` the client passes.
  format: "esm",
  platform: "browser",
  // Matches the browsers Next targets, and is new enough that top-level await
  // inside the bundled dependencies survives without a downlevel transform.
  target: "es2022",
  minify: process.env.NODE_ENV !== "development",
  sourcemap: process.env.NODE_ENV === "development",
  // onnxruntime-web ships Node-only fallbacks behind these; without the
  // define they pull `node:fs`/`node:path` into a browser bundle and esbuild
  // fails to resolve them.
  define: { "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production") },
  external: ["node:fs", "node:path", "node:url", "fs", "path", "url", "sharp", "onnxruntime-node"],
  logLevel: "info",
});
