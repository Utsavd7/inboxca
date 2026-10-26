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
  // No other website may show InboxCA's pages inside its own (clickjacking). The enquiry form
  // is the one exception: its page lists the firm's own websites instead (proxy.ts).
  async headers() {
    return [{
      source: "/((?!f/).*)",
      headers: [
        { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    }];
  },
};
export default nextConfig;
