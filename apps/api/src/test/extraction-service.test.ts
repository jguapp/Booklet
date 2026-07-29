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
    const html = await inlineImages('<p>hi</p><img src="https://example.com/photo.png">', "https://example.com/article");
    expect(html).toMatch(/<img src="data:image\/png;base64,[A-Za-z0-9+/=]+">/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves a relative src against the article's URL", async () => {
    fetchMock.mockResolvedValue(pngResponse(16));
    await inlineImages('<img src="/images/photo.png">', "https://example.com/articles/story");
    expect(fetchMock.mock.calls[0][0].toString()).toBe("https://example.com/images/photo.png");
  });

  it("dedupes repeated image URLs into a single fetch", async () => {
    fetchMock.mockResolvedValue(pngResponse(16));
    await inlineImages(
      '<img src="https://example.com/a.png"><img src="https://example.com/a.png">',
      "https://example.com",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves the original src alone when the response isn't an image", async () => {
    fetchMock.mockResolvedValue(new Response("not an image", { status: 200, headers: { "content-type": "text/html" } }));
    const html = await inlineImages('<img src="https://example.com/photo.png">', "https://example.com");
    expect(html).toContain('src="https://example.com/photo.png"');
    expect(html).not.toContain("data:");
  });

  it("leaves the original src alone when the fetch fails", async () => {
    fetchMock.mockRejectedValue(new Error("network error"));
    const html = await inlineImages('<img src="https://example.com/photo.png">', "https://example.com");
    expect(html).toContain('src="https://example.com/photo.png"');
  });

  it("leaves the original src alone when the image exceeds the per-image size cap", async () => {
    fetchMock.mockResolvedValue(pngResponse(4 * 1024 * 1024)); // over the 3MB cap
    const html = await inlineImages('<img src="https://example.com/huge.png">', "https://example.com");
    expect(html).toContain('src="https://example.com/huge.png"');
    expect(html).not.toContain("data:");
  });

  it("returns the input unchanged when there are no images", async () => {
    const html = await inlineImages("<p>no pictures here</p>", "https://example.com");
    expect(html).toBe("<p>no pictures here</p>");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
