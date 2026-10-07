import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Development logs every server action with its arguments, which would put
  // patient search text in the terminal. Search text never goes in logs (§10).
  logging: { serverFunctions: false },
  // The demo is hidden from search engines (ARCHITECTURE.md §10).
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] }];
  },
};

export default nextConfig;
