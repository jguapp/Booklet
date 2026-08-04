# Booklet browser extension

A Manifest V3 extension: log in once, then save the page you're on to your
Booklet library in a single click of the toolbar button, or from the
right-click context menu.

The toolbar button has no popup while you're signed in -- a popup and
`chrome.action.onClicked` are mutually exclusive (whichever is set wins, and
a declared popup means the click event never fires), so one-click saving is
expressed by clearing `default_popup` while a session exists and restoring it
when there isn't one, in `background.ts`'s `syncActionBehaviour`. Signed out,
the button still opens the login form. That swap is the whole feature, and
it's what `e2e/extension.spec.ts` asserts.

Since a click no longer opens anything, feedback is a badge on the icon --
`✓` saved, `!` failed or not a saveable page (`about:`, `chrome://`, a blank
tab). Saving a page that's already in the library counts as `✓`: it's the
expected result of clicking twice, and the page is in Booklet either way.
Account details moved with it -- the signed-in address is the button's
tooltip, and logging out is a right-click item on the icon.

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

The popup reserves its full height in CSS (`#root { min-height: 250px }`)
rather than letting the panel size itself once content arrives. That looks
like dead styling and isn't: everything below the static header is appended
by `popup.ts` only after an awaited `chrome.storage` read, so without it the
document is 84px tall at `DOMContentLoaded` and the browser opens a
header-only sliver it then has to re-measure and grow. Chrome and stock
Firefox both regrow correctly; Gecko *forks* that reimplement panel chrome
(Zen Browser, and the same class of bug in other Firefox derivatives) are
where a panel measured once at 84px stays there and presents as an empty
box. Reserving the height means the popup opens at its final 334px and never
resizes -- worth keeping even though vanilla Firefox doesn't need it, since
"blank popup, no error anywhere" is close to undebuggable when reported from
a fork. Relatedly, the top-level `renderSaveView()` call has a `.catch()`
that renders the failure into the popup: a floating rejection there leaves
`#root` empty forever, and the popup's devtools target closes along with the
panel, so there's otherwise nowhere for the error to show up.

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

## Highlighting the open web

`src/content.ts` runs on every http(s) page: select text, click **Highlight**,
and it's painted and stored locally. Once a page has any, a floating bar
offers **Open in Booklet**, which saves the article and attaches every
highlight to it.

The interesting part is anchoring. Booklet stores highlights against
`Article.extractedText` -- Readability's output -- which is a *different
string* from the live page's text: no nav, no ads, different whitespace, and
completely different offsets. So the offsets captured here are explicitly not
the source of truth. What survives the gap is the TextQuote part (`exact`
plus 32 characters of context either side), which
`packages/shared/src/highlight-anchor.ts`'s `resolveTextPosition` searches for
*before* it ever trusts `start`/`end`. That function was written for
re-extraction drift; live page → `extractedText` is the same problem with a
larger delta, so no new anchoring mechanism and no schema change were needed
-- the extension just has to capture good context. `src/text-anchor.ts`
mirrors its resolution ladder for the in-page case (restoring highlights after
a reload, where the DOM has also moved on).

Two things that look like over-engineering and aren't:

- **The UI lives in a shadow root.** Page CSS is hostile by default -- broad
  resets, `!important`, z-index wars -- and a shadow root is the only way to
  get a toolbar that renders the same everywhere without a per-site
  stylesheet. The host carries `data-booklet-ui` so the text-mapping walker
  skips it; otherwise the bar's own label could end up quoted inside a
  highlight's context.
- **The import runs in the background script**, not the content script. The
  page's origin can't reach the API (CORS only allows the extension origin),
  and the session token deliberately lives in extension storage where page
  scripts can't read it.

Local highlights are cleared only once the server confirms the import, so a
failure can't silently lose them. Highlights that no longer resolve in the
page are kept rather than dropped -- the page may just not have finished
rendering, and they still import fine, since the server re-anchors
independently of whether the extension could repaint them.

`GET /api/articles?url=` exists for this: on a 409 the import attaches to the
already-saved article instead of stranding the highlights, and that lookup
matches the same raw-or-canonical way the duplicate check does.

## What's here

- `src/popup.ts` / `popup.html` -- the toolbar popup: login form, or (once
  signed in) a "Save this page" button.
- `src/background.ts` -- the MV3 service worker; owns one-click save
  (`chrome.action.onClicked` + the popup swap above), badge feedback, and the
  "Save page to Booklet" / "Log out of Booklet" context menu items.
  `syncActionBehaviour` re-runs on every worker wake, not just
  install/startup, since an MV3 worker is torn down freely and the whole
  thing is one storage read.
- `src/content.ts` -- the in-page highlighting UI (shadow-root toolbar and
  bar), injected on every http(s) page.
- `src/text-anchor.ts` -- DOM range ↔ text offset mapping, anchor
  re-resolution, and the `<mark>` painting/unpainting.
- `src/highlight-store.ts` -- per-page pending highlights in
  `chrome.storage.local`.
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
