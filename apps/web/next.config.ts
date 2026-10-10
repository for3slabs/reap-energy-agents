import type { NextConfig } from "next";

// The browser always calls /api on THIS origin; Next proxies it to the FastAPI deployment.
// Same origin = no CORS and nothing for a content blocker (Brave Shields) to treat as cross-site.
const AGENT_API = (process.env.AGENT_API_ORIGIN ?? "http://localhost:8811").replace(/\/$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${AGENT_API}/api/:path*` }];
  },
  cacheComponents: true,
  partialPrefetching: true,
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
