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
unpacked** → select `apps/extension/dist`.

Points at `http://localhost:4000` by default (see `src/config.ts`). Change
that -- and the matching `host_permissions` entry in `manifest.json` -- to
point at a deployed API instead.

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

Loaded in a real Chromium instance (via Playwright's
`launchPersistentContext` + `--load-extension`, not just "it builds"): the
manifest loads without errors, login persists a session via
`chrome.storage.local`, and an authenticated fetch from the
`chrome-extension://` origin successfully creates a real article through the
API (this is also what confirmed the API's CORS needed to explicitly allow
`chrome-extension://` origins -- browser extensions aren't `http(s)://`
origins, so the existing WEB_ORIGIN/localhost allowance didn't cover them).

Not yet done: publishing to the Chrome Web Store (needs a developer account
this environment doesn't have) and an icon set (needs actual design work,
not something to fake with placeholder art).
