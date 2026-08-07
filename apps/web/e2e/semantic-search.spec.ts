import { expect, test } from "@playwright/test";

/**
 * Local semantic search (#156) -- the browser half.
 *
 * The unit tests around this stub the embedder, and the API's own
 * verify-embeddings script proves the model in Node. Neither touches the thing
 * most likely to be broken here, which is the worker *artifact*: whether the
 * bundle at /workers/embedding-worker.js actually loads and runs in a browser.
 *
 * That is not a theoretical worry. The obvious implementation --
 * `new Worker(new URL("./embedding-worker.ts", import.meta.url))` -- builds
 * cleanly under Turbopack and ships raw TypeScript to the browser, so
 * `next build` exiting 0 says nothing at all about this working. Hence a test
 * that runs it.
 */

test("@live the embedding worker loads in the browser and matches by meaning", async ({ page }) => {
  test.setTimeout(180_000); // first run downloads ~25MB of weights from the Hub

  await page.goto("/library");

  const result = await page.evaluate(async () => {
    // Driven directly rather than through the settings toggle: this is a test
    // of the worker bundle, and going through the UI would make a failure here
    // indistinguishable from a failure in the indexing flow.
    const worker = new Worker("/workers/embedding-worker.js", { type: "module" });

    const texts = [
      "why deadlines make people creative",
      // Shares no content word with the query. Keyword search cannot find
      // this; that is the entire point of the feature.
      "Constraints and time pressure often sharpen inventiveness, forcing novel solutions under limited resources.",
      "Boil the pasta in salted water for eleven minutes, then drain and add butter.",
    ];

    const vectors = await new Promise<Float32Array[]>((resolve, reject) => {
      worker.addEventListener("message", (event) => {
        // Download progress is interleaved with replies; anything that treats
        // every message as a response rejects on the first one.
        if (event.data.kind === "model-progress") return;
        if (event.data.ok) resolve(event.data.vectors);
        else reject(new Error(event.data.error));
      });
      // Fires when the bundle itself fails to parse or load -- which is the
      // exact failure mode a raw-.ts worker produces.
      worker.addEventListener("error", (event) => reject(new Error(event.message || "worker failed to load")));
      worker.postMessage({ id: 1, texts });
    });

    const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i], 0);
    const [q, related, unrelated] = vectors;
    worker.terminate();

    // Already unit length, so a dot product is the cosine.
    return {
      dimensions: q.length,
      magnitude: Math.sqrt(dot(q, q)),
      relatedScore: dot(q, related),
      unrelatedScore: dot(q, unrelated),
    };
  });

  expect(result.dimensions).toBe(384);
  expect(result.magnitude).toBeCloseTo(1, 2);
  expect(result.relatedScore).toBeGreaterThan(result.unrelatedScore);
  // A floor as well as a comparison: beating an unrelated sentence is easy if
  // both scores are noise near zero.
  expect(result.relatedScore).toBeGreaterThan(0.2);
});

test("@live the model download reports progress rather than going silent", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/library");

  // A fresh browser context has an empty Cache API, so this is genuinely a
  // cold download -- which is the only state where progress can be observed.
  const report = await page.evaluate(async () => {
    const worker = new Worker("/workers/embedding-worker.js", { type: "module" });
    const fractions: number[] = [];

    await new Promise<void>((resolve, reject) => {
      worker.addEventListener("message", (event) => {
        if (event.data.kind === "model-progress") {
          if (event.data.total > 0) fractions.push(event.data.loaded / event.data.total);
          return;
        }
        if (event.data.ok) resolve();
        else reject(new Error(event.data.error));
      });
      worker.addEventListener("error", (event) => reject(new Error(event.message || "worker failed")));
      worker.postMessage({ id: 1, texts: ["a short sentence to force the model to load"] });
    });
    worker.terminate();

    return { count: fractions.length, max: Math.max(0, ...fractions), monotonic: fractions.every((f, i, a) => i === 0 || f >= a[i - 1]) };
  });

  expect(report.count).toBeGreaterThan(0);
  // Summed across files, so it must climb rather than restart per file --
  // that is the whole reason the worker aggregates instead of forwarding raw
  // per-file events.
  expect(report.monotonic).toBe(true);
  expect(report.max).toBeGreaterThan(0.5);
});

test("the setting is off by default and downloads nothing until turned on", async ({ page }) => {
  const modelRequests: string[] = [];
  page.on("request", (req) => {
    if (/huggingface\.co|\.onnx|embedding-worker/.test(req.url())) modelRequests.push(req.url());
  });

  await page.goto("/settings/library");
  const group = page.getByRole("group", { name: "Semantic search" });
  await expect(group).toBeVisible();

  // Off is the selected state -- the download is the user's to opt into.
  await expect(group.getByRole("button", { name: "Off", exact: true })).toHaveClass(/bg-accent/);
  expect(modelRequests).toEqual([]);

  // Turning it on with an empty library must still not fetch the model: there
  // is nothing to embed, and the worker is only constructed when there is.
  await group.getByRole("button", { name: "On", exact: true }).click();
  await expect(page.getByText(/fully indexed/i)).toBeVisible();
  expect(modelRequests).toEqual([]);

  // The choice survives a reload, like the other device-local prefs.
  await page.reload();
  await expect(
    page.getByRole("group", { name: "Semantic search" }).getByRole("button", { name: "On", exact: true }),
  ).toHaveClass(/bg-accent/);
});
