import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page in this app is a live, per-household financial view — there
  // is no meaningful static shell to prerender and we never want stale
  // cached data here, so Next 16's Cache Components model (which defaults
  // to trying to statically prerender everything) is actively the wrong
  // fit. Disabling it reverts to standard per-request SSR for dynamic
  // routes, which is what every page here actually is.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
