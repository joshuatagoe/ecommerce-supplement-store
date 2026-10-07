import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Development logs every server action with its arguments, which would put
  // patient search text in the terminal. Search text never goes in logs (§10).
  // Request logging would put pay-link tokens there too (§6).
  logging: { serverFunctions: false, incomingRequests: { ignore: [/\/pay\//] } },
  // The demo is hidden from search engines (ARCHITECTURE.md §10).
  async headers() {
    return [
      { source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
      // The pay page sends no Referer, so the link never leaks to another site (§6).
      { source: "/pay/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default nextConfig;
