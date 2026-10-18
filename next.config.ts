import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // pdf.js reads PDF text on the server from node_modules; the browser gets its worker
  // from public/, copied there on install.
  serverExternalPackages: ["pdfjs-dist"],
  // The dev badge sits on top of the sidebar's account row.
  devIndicators: false,
  turbopack: { root: process.cwd() },
  images: { formats: ["image/avif", "image/webp"] },
  // Client imports upload a spreadsheet, and a person uploads a client's file of up to
  // 25 MB (larger files wait for the file worker).
  experimental: { serverActions: { bodySizeLimit: "26mb" } },
};
export default nextConfig;
