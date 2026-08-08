import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * A ~40-line stand-in for @testing-library/react's `render`/`cleanup`.
 *
 * Not written by preference -- written because the library cannot resolve the
 * same React instance the components use (#166). This repo sets
 * `nodeLinker: hoisted` in pnpm-workspace.yaml (Metro can't traverse pnpm's
 * junctions on Windows), so packages land in the *root* node_modules and
 * resolve their own dependencies from there. @testing-library/react therefore
 * picks up root's `react` (19.0.0, hoisted from apps/mobile, which Expo pins)
 * and root's `react-dom` (19.2.8, hoisted from Prisma Studio of all things),
 * while apps/web has its own matched 19.2.4 pair nested because it conflicts
 * with root. Rendering across two React instances fails as a bare "Cannot read
 * properties of null (reading 'useState')", or silently renders nothing at
 * all. resolve.alias, resolve.dedupe and server.deps.inline were all tried;
 * none work, because the renderer resolves React through Node before Vite ever
 * sees the import.
 *
 * This file, however, lives inside apps/web -- so its own `react` and
 * `react-dom/client` imports resolve apps/web's copies, the same ones the
 * components import. One instance, no resolver tricks, and no third React
 * version added to a workspace that already has too many.
 *
 * It deliberately implements only what the tests here need: mount, unmount,
 * and a `screen`-ish query by title. Reach for the real library instead if
 * this starts growing user-event simulation or complex queries -- by then the
 * dependency situation is worth fixing properly rather than working around.
 */

// React's act() refuses to run without this, and warns loudly about it.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Mounted {
  container: HTMLElement;
  unmount: () => void;
}

const mounted: Mounted[] = [];

export function render(ui: ReactElement): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);

  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });

  const entry: Mounted = {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
  mounted.push(entry);
  return entry;
}

/** Unmounts everything rendered since the last cleanup. Without this a tree
 * stays in the document between tests, and "found two elements" becomes a
 * confusing failure in whichever test happens to run second. */
export function cleanup(): void {
  while (mounted.length) mounted.pop()!.unmount();
}

/** Runs `fn` inside act(), so state updates it triggers are flushed before the
 * assertion that follows. */
export function fire(fn: () => void): void {
  act(fn);
}

export function getByTitle(title: string): HTMLElement {
  const el = document.body.querySelector<HTMLElement>(`[title="${title}"]`);
  if (!el) throw new Error(`no element with title=${JSON.stringify(title)}`);
  return el;
}

export function queryByTitle(title: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(`[title="${title}"]`);
}
