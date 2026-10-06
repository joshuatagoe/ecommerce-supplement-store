import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The demo is hidden from search engines (ARCHITECTURE.md §10).
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] }];
  },
};

export default nextConfig;
