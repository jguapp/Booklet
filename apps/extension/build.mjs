import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const watch = process.argv.includes("--watch");

// Deployed-build config. Extensions have no env system of their own, so
// these are baked into the bundle here (see src/config.ts) *and* into the
// manifest, which must agree with the code: a fetch to an origin missing
// from host_permissions is blocked by the browser, and the content script
// must not inject into the web app's own pages. Unset means the localhost
// dev defaults everywhere, which is what the checked-in manifest declares.
const apiUrl = normalizeUrl(process.env.BOOKLET_API_URL, "BOOKLET_API_URL");
const webAppUrl = normalizeUrl(process.env.BOOKLET_WEB_APP_URL, "BOOKLET_WEB_APP_URL");

function normalizeUrl(value, name) {
  if (!value) return undefined;
  try {
    new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL: ${value}`);
  }
  // config.ts consumers append paths (`${API_URL}${path}`), so a trailing
  // slash would produce double-slash URLs.
  return value.replace(/\/+$/, "");
}

/** host_permissions / exclude_matches entries are match patterns, not URLs --
 * scheme://host/path. The whole origin is the right scope for both. */
function toMatchPattern(url) {
  return `${new URL(url).origin}/*`;
}

/** Replaces the localhost dev entry in-place, and refuses to build if it
 * isn't there -- a silent miss would ship a bundle pointing at the deployed
 * API while the manifest still only grants localhost, and every fetch would
 * be blocked by the browser with nothing said at build time. */
function replaceMatchPattern(list, devEntry, replacement) {
  const i = list.indexOf(devEntry);
  if (i === -1) {
    throw new Error(`expected manifest entry ${devEntry} not found; update build.mjs to match manifest.json`);
  }
  list[i] = replacement;
}

mkdirSync("dist", { recursive: true });
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
if (apiUrl) {
  replaceMatchPattern(manifest.host_permissions, "http://localhost:4000/*", toMatchPattern(apiUrl));
}
if (webAppUrl) {
  replaceMatchPattern(manifest.content_scripts[0].exclude_matches, "http://localhost:3000/*", toMatchPattern(webAppUrl));
}
writeFileSync("dist/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
cpSync("src/popup.html", "dist/popup.html");
cpSync("icons", "dist/icons", { recursive: true, filter: (src) => !src.endsWith(".svg") });

const shared = {
  bundle: true,
  outdir: "dist",
  target: ["chrome110", "firefox112"], // matches manifest.json's strict_min_version
  sourcemap: true,
  define: {
    // Always defined -- an unreplaced bare identifier would be a runtime
    // ReferenceError, not undefined, in the browser.
    __BOOKLET_API_URL__: apiUrl ? JSON.stringify(apiUrl) : "undefined",
    __BOOKLET_WEB_APP_URL__: webAppUrl ? JSON.stringify(webAppUrl) : "undefined",
  },
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
  console.log(
    `built to dist/ (API: ${apiUrl ?? "http://localhost:4000 (dev default)"}, web app: ${webAppUrl ?? "http://localhost:3000 (dev default)"})`,
  );
}
