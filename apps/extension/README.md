# Booklet browser extension

A Manifest V3 extension: log in once, then save the page you're on to your
Booklet library from the toolbar popup or the right-click context menu.

Authenticated only -- there's no local/anonymous mode here the way there is
in the web app. An extension can't reach the web app's IndexedDB (different
origin, different storage partition), and duplicating that whole local-first
storage layer just for the extension isn't worth it for what this is: a
convenience for people who already have an account and want a faster way to
save pages than opening the web app.

## Develop

```bash
pnpm install
pnpm --filter @booklet/extension build   # one-shot build to dist/
pnpm --filter @booklet/extension dev     # rebuilds on change
```

Then in Chrome: `chrome://extensions` → enable Developer mode → **Load
unpacked** → select `apps/extension/dist`. In Firefox:
`about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** →
select `apps/extension/dist/manifest.json`.

Points at `http://localhost:4000` by default (see `src/config.ts`). Change
that -- and the matching `host_permissions` entry in `manifest.json` -- to
point at a deployed API instead.

## Firefox support

`manifest.json`'s `background` declares both `service_worker` (Chrome) and
`scripts` (Firefox, which still ignores `service_worker` even in current
versions -- confirmed via `web-ext lint`, not just inferred from docs) so
one manifest works on both, plus a `browser_specific_settings.gecko.id` --
Firefox requires a stable id for a MV3 add-on. The extension code itself
uses the `chrome.*` namespace throughout (not `browser.*`); Firefox ships
`chrome.*` as a compatibility alias with the same promise-based calling
convention this code already uses, so no polyfill was needed.

`strict_min_version` is `142.0` -- not an arbitrary floor, but the actual
minimum Firefox version that supports every manifest key this extension
uses (`background.type: "module"` needs 112+; the required
`data_collection_permissions` key, added under Mozilla's late-2025 data
transparency policy, needs 140 desktop / 142 Android). `pnpm lint:firefox`
runs Mozilla's own `web-ext lint` against the real built `dist/` and is
wired into CI (`test-extension-e2e` job) specifically to catch exactly
this class of "manifest key exists but the declared min version predates
browser support for it" mismatch automatically going forward.

The API's CORS config (`apps/api/src/app.ts`) allows both
`chrome-extension://` and `moz-extension://` origins -- browser extensions
aren't `http(s)://` origins CORS can pin the normal way, and Firefox's
scheme is different from Chrome's. Verified with a real, currently-passing
regression test (`apps/api/src/test/integration.test.ts`'s `cors` describe
block) confirmed to actually fail without the `moz-extension://` allowance,
not just added alongside it.

Verify a real, unpacked build actually loads in Firefox (not just passes
lint) with:

```bash
pnpm --filter @booklet/extension build
pnpm --filter @booklet/extension run:firefox   # launches real Firefox with it loaded as a temporary add-on
```

Not done: publishing to addons.mozilla.org (needs a Mozilla developer
account this environment doesn't have -- everything above is what that
submission would need to pass review with, not a substitute for actually
submitting it) and Safari support (needs Xcode's
`safari-web-extension-converter`, macOS-only).

Not automated: there's no Firefox equivalent of `e2e/extension.spec.ts`
(login through the popup, save a page through the real API) -- Playwright
doesn't support loading an unpacked WebExtension into Firefox the way it
does Chromium's `--load-extension`, unlike the manifest-level and
CORS-level checks above, which are both real automated regression
coverage now, not one-off manual checks.

## What's here

- `src/popup.ts` / `popup.html` -- the toolbar popup: login form, or (once
  signed in) a "Save this page" button.
- `src/background.ts` -- the MV3 service worker; registers the "Save page to
  Booklet" right-click context menu item.
- `src/api.ts` -- a small fetch wrapper, same shape as the web app's
  `lib/api/client.ts` but using `chrome.storage.local` instead of
  `localStorage` for the access token (extension storage, not accessible to
  web pages). No silent-refresh-on-401 loop like the web client has --  if
  the access token's expired, the popup just shows the login form again.

## Verified

`e2e/extension.spec.ts` loads the real built `dist/` into an actual
Chromium instance (via Playwright's `launchPersistentContext` +
`--load-extension`, not just "it builds") and checks: the manifest loads
and registers a background service worker, login persists a session via
`chrome.storage.local`, and an authenticated fetch from the
`chrome-extension://` origin successfully creates a real article through the
API (this is also what confirmed the API's CORS needed to explicitly allow
`chrome-extension://` origins -- browser extensions aren't `http(s)://`
origins, so the existing WEB_ORIGIN/localhost allowance didn't cover them).

```bash
pnpm --filter @booklet/extension build
pnpm --filter @booklet/api dev            # needs a live API on :4000
pnpm --filter @booklet/extension test:e2e
```

Runs headed, not headless -- confirmed empirically that Chromium's headless
mode (new or old) never registers the background service worker for a
loaded extension, headless or not. CI runs it under `xvfb-run` for exactly
that reason (see `test-extension-e2e` in `.github/workflows/ci.yml`).

Icon set: `icons/icon.svg` is the source (a bookmark-ribbon mark in the web
app's accent teal); `icons/icon{16,32,48,128}.png` are rendered from it and
referenced from both `icons` and `action.default_icon` in `manifest.json`.
After editing the SVG, regenerate with `pnpm --filter @booklet/extension
icons` (`icons/render.mjs` -- rasterizes via headless Chromium, already a
devDependency for e2e, so no image-editing dependency was needed).

Not yet done: publishing to the Chrome Web Store or addons.mozilla.org
(both need developer accounts this environment doesn't have).
