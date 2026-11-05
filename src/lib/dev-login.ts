// The developer preview's person switcher (npm run preview, app/dev/switch): signs this browser
// in as one of the demo firm's invented people, with their real email code and 2 step code made
// on the server. Only for developers on their own laptop, never for real users: every guard
// below is checked on every request, and the switcher is not found when one fails.
export const DEMO_FIRM = "Demo CA Firm";
// Exactly these people (scripts/demo-firm.mjs makes the owner, scripts/demo-data.mts the rest),
// with their 2 step keys in .env.local as DEMO_<ROLE>_TOTP.
export const DEMO_PEOPLE = {
  owner: "demo-owner@inboxca.test",
  partner: "nikhil.partner@demo.inboxca.test",
  manager: "priya.manager@demo.inboxca.test",
  staff: "ravi.staff@demo.inboxca.test",
  front_desk: "kiran.frontdesk@demo.inboxca.test",
} as const;
export type DemoRole = keyof typeof DEMO_PEOPLE;

const LOCAL = ["localhost", "127.0.0.1", "[::1]"];
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

// (1) npm run preview turned it on for this server only; (2) and (3) the database is the local
// Supabase on this laptop (next start always runs as production, so (2) rests on (3)); (5) the
// request came to this laptop's own address, and a form posted to it came from that address too.
export function devLoginOpen(env: Record<string, string | undefined>, host: string | null, origin?: string | null) {
  if (env.DEV_LOGIN !== "1") return false;
  if (!LOCAL.includes(hostOf(env.SUPABASE_URL ?? ""))) return false;
  if (!host || !LOCAL.includes(hostOf(`http://${host}`))) return false;
  return origin === undefined || (!!origin && hostOf(origin) === hostOf(`http://${host}`));
}

// (4) and (6) one of the demo people by their exact address, never anyone else.
export const demoEmail = (role: string) => (Object.hasOwn(DEMO_PEOPLE, role) ? DEMO_PEOPLE[role as DemoRole] : null);
export const demoKeyName = (role: DemoRole) => `DEMO_${role.toUpperCase()}_TOTP`;
