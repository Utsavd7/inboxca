import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: process.cwd() },
  images: { formats: ["image/avif", "image/webp"] },
};
export default nextConfig;
