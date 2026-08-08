// Extensions have no runtime env system and no build-time one the way
// Next.js or Expo do, so build.mjs bakes these two globals in with esbuild's
// `define`, from BOOKLET_API_URL / BOOKLET_WEB_APP_URL -- the same variable
// name the e2e suite already reads. build.mjs also rewrites the matching
// manifest entries (host_permissions for the API, the content script's
// exclude_matches for the web app), which used to be a remember-to-edit-
// two-files step this comment could only warn about.
declare const __BOOKLET_API_URL__: string | undefined;
declare const __BOOKLET_WEB_APP_URL__: string | undefined;

export const API_URL = __BOOKLET_API_URL__ ?? "http://localhost:4000";

/** Where to open an article after importing it -- the web app, not the API. */
export const WEB_APP_URL = __BOOKLET_WEB_APP_URL__ ?? "http://localhost:3000";
