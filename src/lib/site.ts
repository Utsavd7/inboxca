// One build-time switch. Rebuild after changing it. No public hostname is assumed.
export const SITE_PUBLIC = process.env.SITE_PUBLIC === "true";
export const contactEmail = "orelu.team@gmail.com";
// The company site, opened from the Orelu logo in the footer.
export const oreluUrl = "https://orelu.netlify.app/";
export const siteDescription =
  "InboxCA is an AI back office for Indian CA firms that works from your firm's email.";

// Optional, off until set at build time: a Cloudflare Web Analytics token. Empty: the site counts nothing and calls no other server.
export const analyticsToken = process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN || "";
