// Regenerates icon{16,32,48,128}.png from icon.svg. No image-editing
// dependency needed for a single-color flat icon: headless Chromium (already
// a devDependency for e2e) rasterizes the SVG at each exact pixel size.
//
//   pnpm --filter @booklet/extension exec node icons/render.mjs

import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(path.join(dir, "icon.svg"), "utf8");
const sizes = [16, 32, 48, 128];

const html = `<!doctype html><html><head><style>
  html, body { margin: 0; padding: 0; background: transparent; }
  svg { display: block; width: 100vw; height: 100vh; }
</style></head><body>${svg}</body></html>`;

const browser = await chromium.launch();
for (const size of sizes) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.screenshot({ path: path.join(dir, `icon${size}.png`), omitBackground: true });
  await page.close();
  console.log(`wrote icon${size}.png`);
}
await browser.close();
