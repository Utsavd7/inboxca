import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: process.cwd() },
  images: { formats: ["image/avif", "image/webp"] },
  // Client imports upload a spreadsheet; 500 clients is far below this.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};
export default nextConfig;
