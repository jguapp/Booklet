import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Unit tests for apps/web (#165). Until this existed, ~19,000 lines of the
 * app's own logic had no runner at all: packages/shared had vitest, apps/api
 * had vitest, and everything in between was covered only by Playwright, at
 * whole-browser cost and whole-browser latency.
 *
 * That gap has a measured cost. Three real bugs shipped that a unit test here
 * would have caught in under a second each -- both chunk-0 sizing bugs in the
 * TTS chunker (which is exactly why it was moved to packages/shared), the
 * read-along section anchor resolving to the wrong element at a text-node
 * boundary, and the highlight popover dismissing itself on a scroll event
 * that arrived after it opened. Every one surfaced as a slow, intermittent
 * e2e failure that read like flakiness.
 *
 * jsdom rather than node, because most of what's worth testing here is DOM
 * logic (offset<->node bridging, section anchoring) that has no meaning
 * without a document. jsdom does no layout, though: getBoundingClientRect and
 * Range#getClientRects return zeros, so anything geometry-dependent belongs
 * in Playwright, not here.
 *
 * Rendering React components is deliberately NOT set up yet -- see #166. It
 * needs @testing-library/react, which cannot currently resolve the same React
 * instance the components do: this repo carries three copies (root react
 * 19.0.0, which Expo pins and apps/mobile resolves; root react-dom 19.2.8;
 * apps/web's own 19.2.4 pair). Rendering across two instances fails as a bare
 * "Cannot read properties of null (reading 'useState')", or silently renders
 * nothing. That is a dependency-hygiene problem worth fixing on its own terms
 * rather than papering over with resolver aliases here -- attempts with
 * resolve.alias, resolve.dedupe and server.deps.inline all failed, because
 * the renderer resolves React through Node before Vite ever sees it.
 *
 * e2e is deliberately left out of this runner: Playwright owns e2e/, and
 * running the two in one command would mean neither can be run alone.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    // Playwright's own specs are .spec.ts under e2e/ -- excluded explicitly
    // rather than by convention, so adding a src/**/*.spec.ts later can't
    // quietly pull the browser suite into the unit run.
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
  },
  resolve: {
    // Mirrors the "@/*" path alias in tsconfig.json. Kept in sync by hand;
    // there is only one, and adding vite-tsconfig-paths for a single mapping
    // is more dependency than it is worth.
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
