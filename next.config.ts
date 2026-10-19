import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: { "/app/files/**": ["./node_modules/pdfjs-dist/standard_fonts/**", "./node_modules/pdfjs-dist/cmaps/**", "./node_modules/pdfjs-dist/wasm/**"] },
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  // The dev badge sits on top of the sidebar's account row.
  devIndicators: false,
  turbopack: { root: process.cwd() },
  images: { formats: ["image/avif", "image/webp"] },
  // Client imports upload a spreadsheet, and a person uploads a client's file of up to
  // 25 MB (larger files wait for the file worker).
  experimental: { serverActions: { bodySizeLimit: "26mb" } },
};
export default nextConfig;
