// Works around a real, reproducible tsx-watch-mode bug: kokoro-js's Node
// path (dist/kokoro.js) loads each voice's .bin file from local disk via
// `path.resolve(__dirname-or-import.meta.dirname, "../voices/<id>.bin")`,
// expecting to find them alongside its own package (node_modules/kokoro-js/
// voices/, where they really do live -- confirmed working under plain
// `node` and plain `tsx`, both resolve correctly). Under `tsx watch`
// specifically, that directory resolves to somewhere else entirely --
// confirmed by hand, twice, on a cold `tsx watch` start (not a hot-reload
// artifact): `apps/api/src/generated/voices/`, i.e. one level up from
// wherever Prisma's own generated client (src/generated/prisma/, which
// also uses __dirname) happens to sit. Exactly why tsx watch's loader
// conflates the two isn't something this script depends on understanding
// -- it just makes sure real voice files exist at that path too, alongside
// the correct one in node_modules, so generation works regardless of which
// directory this particular runner resolves to.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdir, copyFile, readdir } from "node:fs/promises";

const require = createRequire(import.meta.url);
const apiDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Can't require.resolve("kokoro-js/package.json") directly -- its own
// "exports" field doesn't list that subpath. Resolve the real entry file
// instead and walk up to the package root (the first ancestor directory
// literally named "kokoro-js").
let kokoroPkgRoot = path.dirname(require.resolve("kokoro-js"));
while (path.basename(kokoroPkgRoot) !== "kokoro-js") {
  const parent = path.dirname(kokoroPkgRoot);
  if (parent === kokoroPkgRoot) throw new Error("Could not locate the kokoro-js package root");
  kokoroPkgRoot = parent;
}
const sourceVoicesDir = path.join(kokoroPkgRoot, "voices");
const destVoicesDir = path.join(apiDir, "src", "generated", "voices");

const files = (await readdir(sourceVoicesDir)).filter((f) => f.endsWith(".bin"));
await mkdir(destVoicesDir, { recursive: true });
await Promise.all(files.map((f) => copyFile(path.join(sourceVoicesDir, f), path.join(destVoicesDir, f))));

console.log(`[copy-kokoro-voices] copied ${files.length} voice files to src/generated/voices/`);
