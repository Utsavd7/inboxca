import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The dev badge sits on top of the sidebar's account row.
  devIndicators: false,
  turbopack: { root: process.cwd() },
  images: { formats: ["image/avif", "image/webp"] },
  // Client imports upload a spreadsheet, and a person uploads a client's file of up to
  // 50 MB (PLAN.md 5.15), each checked by the file worker before it is saved.
  // A page the sidebar fetched on hover (prefetch true) is used for 30 seconds, the least Next
  // allows, not 5 minutes, so a list changed meanwhile by a job or another person is read again.
  experimental: { serverActions: { bodySizeLimit: "51mb" }, staleTimes: { static: 30 } },
  // No other website may show InboxCA's pages inside its own (clickjacking). These replace a
  // route's own header of the same name, so routes keep their Content-Security-Policy (a
  // client's file is served sandboxed) and Referrer-Policy.
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        // Browsers that reached InboxCA over HTTPS keep to it for two years (ignored over plain
        // HTTP, so the laptop preview is unchanged), and no page may use the camera, microphone
        // or location: InboxCA never asks for them.
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};
export default nextConfig;
