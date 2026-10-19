import type { MetadataRoute } from "next";

// Lets InboxCA be added to a phone's home screen, which iPhones need for notifications.
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
