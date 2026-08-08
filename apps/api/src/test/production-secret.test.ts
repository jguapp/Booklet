import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { MIN_PRODUCTION_SECRET_LENGTH, assertUsableAccessSecret } from "../lib/auth/tokens.js";

/**
 * The production-secret guard (#174).
 *
 * Tested in both directions on purpose. A check that refuses bad secrets but
 * also fires in dev/test/CI would be disabled within a week -- every one of
 * those environments runs on a placeholder, including this suite, which signs
 * its tokens with scripts/verify.mjs's default. "Does not fire outside
 * production" is therefore as much a requirement as "fires in production", so
 * both get assertions rather than one being assumed.
 */
describe("JWT_ACCESS_SECRET strength check", () => {
  const REAL = randomBytes(32).toString("hex");

  describe("in production", () => {
    it("refuses the placeholder CI and verify.mjs actually use", () => {
      // Both are real values checked into this repository -- .github/
      // workflows/ci.yml sets the first, scripts/verify.mjs defaults to the
      // second -- and both are over the length floor, so length alone would
      // let them through.
      expect(() => assertUsableAccessSecret("ci-test-secret-not-for-production", "production")).toThrow(
        /placeholder value checked into this repository/,
      );
      expect(() => assertUsableAccessSecret("verify-secret-not-for-production", "production")).toThrow(
        /placeholder value checked into this repository/,
      );
      expect(() => assertUsableAccessSecret("  CI-Test-Secret-Not-For-Production\n", "production")).toThrow(
        /placeholder/,
      );
    });

    it("refuses anything under the length floor", () => {
      const short = "x".repeat(MIN_PRODUCTION_SECRET_LENGTH - 1);
      expect(() => assertUsableAccessSecret(short, "production")).toThrow(
        new RegExp(`at least ${MIN_PRODUCTION_SECRET_LENGTH} characters`),
      );
      expect(() => assertUsableAccessSecret("booklet", "production")).toThrow(/at least/);
    });

    it("refuses an unset secret, which is the case that already threw", () => {
      expect(() => assertUsableAccessSecret(undefined, "production")).toThrow(/is not set/);
      expect(() => assertUsableAccessSecret("", "production")).toThrow(/is not set/);
    });

    it("accepts a real generated secret, which is the whole point", () => {
      expect(() => assertUsableAccessSecret(REAL, "production")).not.toThrow();
      expect(REAL.length).toBeGreaterThanOrEqual(MIN_PRODUCTION_SECRET_LENGTH);
    });
  });

  describe("everywhere else", () => {
    it("allows the placeholders in dev, test and an unset NODE_ENV", () => {
      for (const env of ["development", "test", undefined]) {
        expect(() => assertUsableAccessSecret("ci-test-secret-not-for-production", env)).not.toThrow();
        expect(() => assertUsableAccessSecret("short", env)).not.toThrow();
      }
    });

    it("still insists on there being a secret at all", () => {
      // The pre-existing behaviour, unchanged: no secret means no signing,
      // in any environment.
      expect(() => assertUsableAccessSecret(undefined, "development")).toThrow(/is not set/);
    });

    it("has not fired for this very process, which runs on verify.mjs's placeholder", () => {
      // The import-time guard in tokens.js already ran when this file was
      // loaded. That it did not throw is the proof that the check is inert
      // outside production -- if it were not, no test in this suite would
      // have got as far as running.
      expect(process.env.NODE_ENV).not.toBe("production");
    });
  });
});
