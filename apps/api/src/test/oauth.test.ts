import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// oauth.ts reads client id/secret from process.env once, at module load (so
// routes/auth.ts can build a static PROVIDERS map) -- these have to be set
// before the dynamic import below, or `configured` would be false for both
// and every authorizeUrl()/exchangeCode() call would be meaningless.
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.GITHUB_CLIENT_ID = "test-github-client-id";
process.env.GITHUB_CLIENT_SECRET = "test-github-client-secret";

const { getOAuthProvider } = await import("../lib/auth/oauth.js");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("oauth providers", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects an unknown provider id", () => {
    expect(getOAuthProvider("facebook")).toBeNull();
  });

  describe("google", () => {
    it("is configured once client id/secret are set", () => {
      expect(getOAuthProvider("google")!.configured).toBe(true);
    });

    it("builds an authorize URL with the redirect URI and state", () => {
      const url = new URL(
        getOAuthProvider("google")!.authorizeUrl({ redirectUri: "https://api.test/callback", state: "abc123" }),
      );
      expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
      expect(url.searchParams.get("client_id")).toBe("test-google-client-id");
      expect(url.searchParams.get("redirect_uri")).toBe("https://api.test/callback");
      expect(url.searchParams.get("state")).toBe("abc123");
      expect(url.searchParams.get("scope")).toContain("email");
    });

    it("exchanges a code for a normalized profile", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ access_token: "fake-token" }))
        .mockResolvedValueOnce(
          jsonResponse({ sub: "google-123", email: "reader@example.com", email_verified: true, name: "Ada Reader" }),
        );

      const profile = await getOAuthProvider("google")!.exchangeCode({
        code: "the-code",
        redirectUri: "https://api.test/callback",
      });

      expect(profile).toEqual({
        providerAccountId: "google-123",
        email: "reader@example.com",
        emailVerified: true,
        name: "Ada Reader",
      });
      // The token exchange must actually present the code and redirect_uri that was granted.
      const tokenCallBody = fetchMock.mock.calls[0][1].body as URLSearchParams;
      expect(tokenCallBody.get("code")).toBe("the-code");
      expect(tokenCallBody.get("redirect_uri")).toBe("https://api.test/callback");
    });

    it("throws if the token exchange fails", async () => {
      fetchMock.mockResolvedValueOnce(new Response("nope", { status: 400 }));
      await expect(
        getOAuthProvider("google")!.exchangeCode({ code: "bad", redirectUri: "https://api.test/callback" }),
      ).rejects.toThrow();
    });

    it("throws if userinfo has no email", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ access_token: "fake-token" }))
        .mockResolvedValueOnce(jsonResponse({ sub: "google-123" }));
      await expect(
        getOAuthProvider("google")!.exchangeCode({ code: "c", redirectUri: "https://api.test/callback" }),
      ).rejects.toThrow();
    });
  });

  describe("github", () => {
    it("builds an authorize URL", () => {
      const url = new URL(
        getOAuthProvider("github")!.authorizeUrl({ redirectUri: "https://api.test/callback", state: "xyz" }),
      );
      expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
      expect(url.searchParams.get("client_id")).toBe("test-github-client-id");
      expect(url.searchParams.get("state")).toBe("xyz");
    });

    it("falls back to /user/emails when /user's email is private", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ access_token: "gh-token" }))
        .mockResolvedValueOnce(jsonResponse({ id: 42, name: "Grace Hopper", email: null }))
        .mockResolvedValueOnce(
          jsonResponse([
            { email: "old@example.com", primary: false, verified: true },
            { email: "primary@example.com", primary: true, verified: true },
          ]),
        );

      const profile = await getOAuthProvider("github")!.exchangeCode({
        code: "c",
        redirectUri: "https://api.test/callback",
      });

      expect(profile).toEqual({
        providerAccountId: "42",
        email: "primary@example.com",
        emailVerified: true,
        name: "Grace Hopper",
      });
    });

    it("throws when no accessible email exists at all", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ access_token: "gh-token" }))
        .mockResolvedValueOnce(jsonResponse({ id: 42, name: "No Email", email: null }))
        .mockResolvedValueOnce(jsonResponse([]));

      await expect(
        getOAuthProvider("github")!.exchangeCode({ code: "c", redirectUri: "https://api.test/callback" }),
      ).rejects.toThrow();
    });

    it("throws if GitHub's token endpoint returns an error body (200 with {error})", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: "bad_verification_code" }));
      await expect(
        getOAuthProvider("github")!.exchangeCode({ code: "c", redirectUri: "https://api.test/callback" }),
      ).rejects.toThrow();
    });
  });
});
