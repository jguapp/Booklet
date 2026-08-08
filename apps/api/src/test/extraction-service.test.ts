import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// assertPublicHost (extraction-service.ts) does a real DNS lookup per image
// host to block SSRF -- stub it to a public IP so these tests exercise the
// image-inlining logic itself, not DNS.
vi.mock("node:dns/promises", () => ({
  default: { lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) },
}));

const { inlineImages } = await import("../services/extraction-service.js");

function pngResponse(bytes: number, contentType = "image/png"): Response {
  const body = new Uint8Array(bytes).fill(1);
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

describe("inlineImages", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rewrites an <img> src to a data: URI when the fetch succeeds", async () => {
    fetchMock.mockResolvedValue(pngResponse(16));
    const { html, skippedImageCount } = await inlineImages(
      '<p>hi</p><img src="https://example.com/photo.png">',
      "https://example.com/article",
    );
    expect(html).toMatch(/<img src="data:image\/png;base64,[A-Za-z0-9+/=]+">/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(skippedImageCount).toBe(0);
  });

  it("resolves a relative src against the article's URL", async () => {
    fetchMock.mockResolvedValue(pngResponse(16));
    await inlineImages('<img src="/images/photo.png">', "https://example.com/articles/story");
    expect(fetchMock.mock.calls[0][0].toString()).toBe("https://example.com/images/photo.png");
  });

  it("dedupes repeated image URLs into a single fetch", async () => {
    fetchMock.mockResolvedValue(pngResponse(16));
    const { skippedImageCount } = await inlineImages(
      '<img src="https://example.com/a.png"><img src="https://example.com/a.png">',
      "https://example.com",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(skippedImageCount).toBe(0);
  });

  it("leaves the original src alone and counts it as skipped when the response isn't an image", async () => {
    fetchMock.mockResolvedValue(new Response("not an image", { status: 200, headers: { "content-type": "text/html" } }));
    const { html, skippedImageCount } = await inlineImages(
      '<img src="https://example.com/photo.png">',
      "https://example.com",
    );
    expect(html).toContain('src="https://example.com/photo.png"');
    expect(html).not.toContain("data:");
    expect(skippedImageCount).toBe(1);
  });

  it("leaves the original src alone and counts it as skipped when the fetch fails", async () => {
    fetchMock.mockRejectedValue(new Error("network error"));
    const { html, skippedImageCount } = await inlineImages(
      '<img src="https://example.com/photo.png">',
      "https://example.com",
    );
    expect(html).toContain('src="https://example.com/photo.png"');
    expect(skippedImageCount).toBe(1);
  });

  it("leaves the original src alone and counts it as skipped when the image exceeds the per-image size cap", async () => {
    fetchMock.mockResolvedValue(pngResponse(4 * 1024 * 1024)); // over the 3MB cap
    const { html, skippedImageCount } = await inlineImages(
      '<img src="https://example.com/huge.png">',
      "https://example.com",
    );
    expect(html).toContain('src="https://example.com/huge.png"');
    expect(html).not.toContain("data:");
    expect(skippedImageCount).toBe(1);
  });

  it("counts only the images that failed, not the ones that succeeded", async () => {
    fetchMock.mockImplementation(async (url: string | URL) => {
      const href = url.toString();
      if (href.includes("good")) return pngResponse(16);
      return new Response("nope", { status: 404 });
    });
    const { skippedImageCount } = await inlineImages(
      '<img src="https://example.com/good.png"><img src="https://example.com/bad.png">',
      "https://example.com",
    );
    expect(skippedImageCount).toBe(1);
  });

  it("counts every image past MAX_IMAGES as skipped without even attempting to fetch them", async () => {
    // A fresh Response per call -- mockResolvedValue would hand out the same
    // Response object to every call, and a Response body can only be read
    // (.arrayBuffer()) once before it throws on the next attempt.
    fetchMock.mockImplementation(async () => pngResponse(16));
    const imgs = Array.from({ length: 35 }, (_, i) => `<img src="https://example.com/${i}.png">`).join("");
    const { skippedImageCount } = await inlineImages(imgs, "https://example.com");
    expect(fetchMock).toHaveBeenCalledTimes(30); // MAX_IMAGES
    expect(skippedImageCount).toBe(5);
  });

  /**
   * The whole-article byte cap, which four concurrent fetch workers used to
   * be able to walk straight past.
   *
   * Each worker computed its own limit as `MAX_TOTAL_IMAGE_BYTES -
   * totalBytes` before any of the others had added theirs, so all four sized
   * themselves against a budget the other three were already spending.
   * Measured against a real server handing out 2MB images: 20MB inlined under
   * a 15MB cap, with a true ceiling of 15MB + 3 * MAX_IMAGE_BYTES = 24MB --
   * on input a hostile page fully controls, ending up in Article.html.
   *
   * Sized in real bytes rather than mocked counters because the accounting
   * being tested is the byte accounting.
   */
  it("holds the whole-article byte budget even with several fetches in flight", async () => {
    const TWO_MB = 2 * 1024 * 1024;
    const MAX_TOTAL_IMAGE_BYTES = 15 * 1024 * 1024;
    // Under the 3MB per-image cap, so nothing is rejected individually -- only
    // the running total can stop this.
    fetchMock.mockImplementation(async () => pngResponse(TWO_MB));

    const imgs = Array.from({ length: 20 }, (_, i) => `<img src="https://example.com/${i}.png">`).join("");
    const { html } = await inlineImages(imgs, "https://example.com");

    const inlined = (html.match(/data:image/g) ?? []).length;
    // Was 10 (20MB). Seven 2MB images is 14MB, the most that fits.
    expect(inlined * TWO_MB).toBeLessThanOrEqual(MAX_TOTAL_IMAGE_BYTES);
    // And it must still fill the budget rather than bailing out early.
    expect(inlined).toBe(7);
  });

  it("returns the input unchanged with a zero count when there are no images", async () => {
    const { html, skippedImageCount } = await inlineImages("<p>no pictures here</p>", "https://example.com");
    expect(html).toBe("<p>no pictures here</p>");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(skippedImageCount).toBe(0);
  });
});
