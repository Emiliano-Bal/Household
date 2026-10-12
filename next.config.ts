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

  // The nav went from eight tabs to five: the countdown became a Dashboard
  // section, and Recurring and Budget became segments inside Expenses.
  // These keep already-shared links working.
  //
  // Temporary (307) rather than permanent (308) on purpose: a 308 is
  // cached hard by browsers, and if this structure is ever revisited those
  // stale redirects would be awkward to undo on machines that saw them.
  // There is no SEO to preserve here that would justify that risk.
  async redirects() {
    return [
      { source: "/h/:householdId/countdown", destination: "/h/:householdId", permanent: false },
      { source: "/h/:householdId/recurring", destination: "/h/:householdId/expenses/recurring", permanent: false },
      { source: "/h/:householdId/budget", destination: "/h/:householdId/expenses/budget", permanent: false },
    ];
  },
};

export default nextConfig;
