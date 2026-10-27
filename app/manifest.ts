import type { MetadataRoute } from "next";

// Lets a browser install InboxCA as an app on a laptop or office PC (PLAN.md 5.17: laptop only;
// notifications are an optional setting for that computer).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "InboxCA",
    short_name: "InboxCA",
    start_url: "/app",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0b1f3a",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
