import type { MetadataRoute } from "next";
import { SITE_PUBLIC } from "@/src/lib/site";
export const dynamic = "force-static";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      ...(SITE_PUBLIC
        ? { allow: "/", disallow: ["/app", "/sign-in", "/auth"] }
        : { disallow: "/" }),
    },
  };
}
