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
that -- and the matching `host_permissions` entry in `manifest.json`, and the
`content_scripts.exclude_matches` entry for the web app's own origin -- to
point at a deployed API and web app instead.

## Permissions

Worth stating plainly, because "what can this thing see" is the question a
reviewer and a user both ask:

- `storage` -- the session token and each page's pending highlights, both in
  `chrome.storage.local`.
- `contextMenus` -- "Save page to Booklet" and the log-out item on the icon.
- `activeTab` -- the popup and the background script read the current tab's
  URL, which needs either this or the far broader `tabs`. `activeTab` is
  granted only for the tab the user just invoked the extension on, and only
  until they navigate away, so it is the narrower of the two by a long way.
- `host_permissions: ["http://localhost:4000/*"]` -- the API, and nothing
  else. Deliberately not `<all_urls>`: the extension never fetches a page's
  content itself, the API does the extraction server-side from the URL it is
  given.

The one broad grant is the content script's `matches`, which covers every
http(s) page. Highlighting cannot ask the user to declare up front which
pages they might highlight on, so that breadth is inherent to the feature
rather than incidental. Two things bound it:

- **Nothing is injected until the feature is used.** `content.ts` registers
  listeners at `document_idle` and builds nothing; the shadow-root host and
  the `<mark>` stylesheet are created on the first real text selection, the
  first click on an existing mark, or a page that already has stored
  highlights. A page the user only reads is left byte-for-byte alone. See
  `ensureUi()`.
- **`exclude_matches` skips the Booklet web app itself**, whose reader has
  its own highlighting UI -- two toolbars fighting over the same selection is
  a conflict, not a feature.

The shadow root is `mode: "open"`, so a page's own scripts can reach into the
extension's UI. That is a deliberate tradeoff, not an oversight: `closed`
would hide the toolbar from Playwright too, which is how `e2e/extension.spec.ts`
drives it, and there is nothing behind it worth hiding -- no token, and the
`<mark>` elements are in the page's DOM regardless.

The session token lives in `chrome.storage.local`, which a web page cannot
read. A *content script* can, though, and this extension runs one on every
page -- in an isolated world, so page JavaScript still cannot reach it, but
that isolation is the only thing between the two. `content.ts` deliberately
imports nothing from `src/api.ts` for that reason: the import runs in the
background script, which is also where the token is read.

`src/api.ts` sends `credentials: "include"`, so the API's httpOnly refresh
cookie rides along with extension requests. It is only actually needed by
`logout()`, which revokes the server-side session via that cookie. Note that
`isAllowedOrigin` in the API allows *any* `chrome-extension://` or
`moz-extension://` origin -- it cannot pin an extension id the way it pins
`WEB_ORIGIN` -- so any extension on the profile can reach the API
cross-origin with credentials. It still needs a bearer token to get past
`requireAuth`, and that token is not in a cookie.

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

`src/content.ts` runs on every http(s) page (except the Booklet web app
itself): select text, click **Highlight**, and it's painted and stored
locally. Once a page has any, a floating bar offers **Open in Booklet**,
which saves the article and attaches every highlight to it. Nothing is
injected into the page until one of those things actually happens -- see
Permissions above.

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
  scripts can't read it. That listener treats its input as untrusted:
  `isImportRequest` validates the whole message (not just its `type`), and
  `isTrustedImportSender` requires the sender to be this extension's own
  content script, in a tab, on the origin the message claims -- because
  without a declared `externally_connectable`, Chrome lets every other
  installed extension call `chrome.runtime.sendMessage` here.

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
  bar). Matched on every http(s) page, but built lazily on first use.
- `src/messages.ts` -- the content script → background message contract, and
  the validation the background script runs on it.
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

### Changed since that pass, and not re-run

`pnpm exec tsc --noEmit`, `pnpm build` and `pnpm lint:firefox` (0 errors) all
pass, but the Playwright suite above **was not re-run** for these -- it needs
a headed browser and a live API on :4000. Anything here that the suite covers
should be re-run before shipping:

- **The in-page UI is built lazily** (`ensureUi()` in `content.ts`) instead of
  at `document_idle`. The highlight/import flow the suite drives is exactly
  the path that triggers it, so this is the change most worth re-running.
- **`manifest.json`** gained `exclude_matches` for the web app's origin and an
  explicit `all_frames: false`.
- **The background message listener** validates its input and its sender. The
  origin check compares `sender.url` (not permission-gated) and deliberately
  skips rather than fails if the browser supplies no URL at all, so that it
  cannot take the import down if that assumption is ever wrong.
- **`getSession`** rejects a malformed stored session instead of treating it
  as valid, and `content.ts` reports a failed `chrome.storage` write instead
  of dropping the rejection.

Not yet done: publishing to the Chrome Web Store or addons.mozilla.org
(both need developer accounts this environment doesn't have).
