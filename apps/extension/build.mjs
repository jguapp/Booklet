import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");

mkdirSync("dist", { recursive: true });
cpSync("manifest.json", "dist/manifest.json");
cpSync("src/popup.html", "dist/popup.html");
cpSync("icons", "dist/icons", { recursive: true, filter: (src) => !src.endsWith(".svg") });

const shared = {
  bundle: true,
  outdir: "dist",
  target: ["chrome110", "firefox112"], // matches manifest.json's strict_min_version
  sourcemap: true,
};

// Two builds because the output formats genuinely differ. The popup and the
// background page are both declared as modules in the manifest; a content
// script is injected as a classic script with no import support, where an
// ESM bundle's top-level `export {}` is a parse error.
const builds = [
  { ...shared, entryPoints: ["src/popup.ts", "src/background.ts"], format: "esm" },
  { ...shared, entryPoints: ["src/content.ts"], format: "iife" },
];

if (watch) {
  await Promise.all(builds.map(async (options) => (await esbuild.context(options)).watch()));
  console.log("watching for changes...");
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
  console.log("built to dist/");
}
