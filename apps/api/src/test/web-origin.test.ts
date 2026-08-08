import { afterEach, describe, expect, it, vi } from "vitest";
import { assertUsableWebOrigin } from "../lib/cors.js";

/**
 * The WEB_ORIGIN boot guard (S6).
 *
 * Same shape as the JWT_ACCESS_SECRET check (production-secret.test.ts):
 * asserted in both directions, because a check that fires in dev/test/CI --
 * none of which set WEB_ORIGIN -- would be reverted immediately, and then
 * production would be unguarded again.
 */
describe("assertUsableWebOrigin", () => {
  describe("in production", () => {
    it("refuses an unset value, which today silently blocks every browser origin", () => {
      expect(() => assertUsableWebOrigin(undefined, "production")).toThrow(/WEB_ORIGIN/);
      expect(() => assertUsableWebOrigin("", "production")).toThrow(/WEB_ORIGIN/);
    });

    it("refuses a trailing slash, which never equals a browser's Origin header", () => {
      expect(() => assertUsableWebOrigin("https://read.example.com/", "production")).toThrow(/trailing slash|exactly/);
    });

    it("refuses anything with a path, query or fragment on it", () => {
      expect(() => assertUsableWebOrigin("https://read.example.com/app", "production")).toThrow();
      expect(() => assertUsableWebOrigin("https://read.example.com?x=1", "production")).toThrow();
    });

    it("refuses a value that is not an absolute http(s) origin at all", () => {
      expect(() => assertUsableWebOrigin("read.example.com", "production")).toThrow();
      expect(() => assertUsableWebOrigin("localhost:3000", "production")).toThrow();
      expect(() => assertUsableWebOrigin("ftp://read.example.com", "production")).toThrow();
    });

    it("accepts the values a real deployment actually has", () => {
      expect(() => assertUsableWebOrigin("https://read.example.com", "production")).not.toThrow();
      expect(() => assertUsableWebOrigin("https://read.example.com:8443", "production")).not.toThrow();
      // docker-compose.yml runs NODE_ENV=production against this one.
      expect(() => assertUsableWebOrigin("http://localhost:3000", "production")).not.toThrow();
    });
  });

  describe("everywhere else", () => {
    it("is inert, because dev, test and CI all run without WEB_ORIGIN", () => {
      for (const env of ["development", "test", undefined]) {
        expect(() => assertUsableWebOrigin(undefined, env)).not.toThrow();
        expect(() => assertUsableWebOrigin("nonsense", env)).not.toThrow();
      }
    });
  });
});

describe("the guard actually runs at import time", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("refuses to load under NODE_ENV=production with WEB_ORIGIN unset", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WEB_ORIGIN", undefined);
    vi.resetModules();

    await expect(import("../lib/cors.js")).rejects.toThrow(/WEB_ORIGIN/);
  });

  it("loads, and pins the one origin, when WEB_ORIGIN is set properly", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WEB_ORIGIN", "https://read.example.com");
    vi.resetModules();

    const { isAllowedOrigin } = await import("../lib/cors.js");
    expect(isAllowedOrigin("https://read.example.com")).toBe(true);
    expect(isAllowedOrigin("https://read.example.com.attacker.test")).toBe(false);
    expect(isAllowedOrigin("http://localhost:3000")).toBe(false);
  });
});
