// Extensions don't have a build-time env-var system the way Next.js does --
// change this (and the matching host_permissions entry in manifest.json)
// when pointing at a deployed API instead of a local dev server.
export const API_URL = "http://localhost:4000";
