import type { Metadata } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import { SITE_PUBLIC, analyticsToken, siteDescription } from "@/src/lib/site";
import "./globals.css";

const words = localFont({
  src: "./fonts/plus-jakarta-sans-latin-variable.woff2",
  weight: "500 800",
  variable: "--font-jakarta",
  display: "swap",
  preload: true,
  adjustFontFallback: "Arial",
});
const figures = localFont({
  src: "./fonts/ibm-plex-mono-latin-500-normal.woff2",
  weight: "500",
  variable: "--font-plex",
  display: "swap",
  preload: true,
  adjustFontFallback: "Arial",
});
export const metadata: Metadata = {
  metadataBase: new URL("http://localhost:3000"),
  title: "InboxCA, a product by Orelu | Less chasing. More doing.",
  description: siteDescription,
  robots: { index: SITE_PUBLIC, follow: SITE_PUBLIC },
  openGraph: {
    title: "InboxCA | Less chasing. More doing.",
    description: siteDescription,
    type: "website",
    images: [
      {
        url: "/brand/social.png",
        width: 1200,
        height: 630,
        alt: "InboxCA. Every client email, read, filed and answered.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "InboxCA | Less chasing. More doing.",
    description: siteDescription,
    images: ["/brand/social.png"],
  },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${words.variable} ${figures.variable}`}>
      <body>
        {children}
        {analyticsToken && (
          // Cloudflare Web Analytics: counts visits without cookies. Off until a token is set.
          <Script
            src="https://static.cloudflareinsights.com/beacon.min.js"
            strategy="afterInteractive"
            data-cf-beacon={JSON.stringify({ token: analyticsToken })}
          />
        )}
      </body>
    </html>
  );
}
