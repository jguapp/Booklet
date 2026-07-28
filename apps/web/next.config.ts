import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@booklet/shared"],
  // Standalone output is what apps/web/Dockerfile's runtime stage expects --
  // a self-contained server bundle instead of needing the full node_modules
  // tree copied into the final image.
  output: "standalone",
};

export default nextConfig;
