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
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => name !== "@booklet/shared");

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "dist/index.js",
  external,
  sourcemap: true,
  logLevel: "info",
});
