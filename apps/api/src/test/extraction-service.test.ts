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

  it("returns the input unchanged with a zero count when there are no images", async () => {
    const { html, skippedImageCount } = await inlineImages("<p>no pictures here</p>", "https://example.com");
    expect(html).toBe("<p>no pictures here</p>");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(skippedImageCount).toBe(0);
  });
});
