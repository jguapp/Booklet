const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

// Root cause of the "Unable to resolve ../../App from .../.pnpm/expo@.../
// node_modules/expo/AppEntry.js" failure this fixes: pnpm's node_modules is
// a tree of symlinks into a central virtual store. Metro's default resolver
// follows symlinks to their real on-disk path *before* doing relative-path
// resolution, so a relative import inside a symlinked package resolves
// against the pnpm store's physical location instead of the project's
// logical layout. unstable_enableSymlinks makes Metro resolve against the
// symlink's logical path instead, which is what a pnpm workspace needs.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.unstable_enableSymlinks = true;
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
