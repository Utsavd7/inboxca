import type { Metadata } from "next";
import localFont from "next/font/local";
import { SITE_PUBLIC, siteDescription } from "@/src/lib/site";
import "./globals.css";

const words = localFont({
  src: "./fonts/plus-jakarta-sans-latin-variable.woff2", weight: "500 800", variable: "--font-jakarta", display: "swap", preload: true, adjustFontFallback: "Arial",
});
const figures = localFont({ src: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", variable: "--font-plex", display: "swap", preload: true, adjustFontFallback: "Arial" });
export const metadata: Metadata = {
  metadataBase: new URL("http://localhost:3000"),
  title: "InboxCA, a product by Orelu | Less chasing. More doing.",
  description: siteDescription,
  robots: { index: SITE_PUBLIC, follow: SITE_PUBLIC },
  openGraph: { title: "InboxCA | Less chasing. More doing.", description: siteDescription, type: "website", images: [{ url: "/brand/social.png", width: 1200, height: 630, alt: "InboxCA. Less chasing. More doing." }] },
  twitter: { card: "summary_large_image", title: "InboxCA | Less chasing. More doing.", description: siteDescription, images: ["/brand/social.png"] },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${words.variable} ${figures.variable}`}><body>{children}</body></html>;
}
