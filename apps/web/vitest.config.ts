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
 * React components ARE renderable here, via a small local helper in
 * src/test/render.tsx rather than @testing-library/react. That is not a
 * preference: the library sits in the *root* node_modules (this workspace uses
 * `nodeLinker: hoisted`, see pnpm-workspace.yaml) and so resolves root's react
 * 19.0.0 -- hoisted from apps/mobile, which Expo pins -- and root's react-dom
 * 19.2.8, hoisted from Prisma Studio. apps/web has its own matched 19.2.4 pair
 * nested because it conflicts with root, so rendering through the library
 * crosses two React instances and fails as a bare "Cannot read properties of
 * null (reading 'useState')", or silently renders nothing. resolve.alias,
 * resolve.dedupe and server.deps.inline were all tried; none work, because the
 * renderer resolves React through Node before Vite sees the import. A helper
 * that lives inside apps/web resolves apps/web's React, which is the whole
 * trick (#166).
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
