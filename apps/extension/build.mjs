import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");

mkdirSync("dist", { recursive: true });
cpSync("manifest.json", "dist/manifest.json");
cpSync("src/popup.html", "dist/popup.html");
cpSync("icons", "dist/icons", { recursive: true, filter: (src) => !src.endsWith(".svg") });

const options = {
  entryPoints: ["src/popup.ts", "src/background.ts"],
  bundle: true,
  outdir: "dist",
  format: "esm",
  target: ["chrome110", "firefox112"], // matches manifest.json's strict_min_version
  sourcemap: true,
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("watching for changes...");
} else {
  await esbuild.build(options);
  console.log("built to dist/");
}
