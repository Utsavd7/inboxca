import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The dev badge sits on top of the sidebar's account row.
  devIndicators: false,
  turbopack: { root: process.cwd() },
  images: { formats: ["image/avif", "image/webp"] },
  // Client imports upload a spreadsheet, and a person uploads a client's file of up to
  // 50 MB (PLAN.md 5.15), each checked by the file worker before it is saved.
  experimental: { serverActions: { bodySizeLimit: "51mb" } },
};
export default nextConfig;
