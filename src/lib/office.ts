import { createHmac } from "node:crypto";
import { supabaseAdmin } from "./supabase";

// The office connection (PLAN.md 5.8, 5.17.3): the office's public internet address as the
// server sees it. IPv4 is matched exactly, IPv6 by its /64 prefix. A firm may have several
// lines. Nothing a PC says about itself is trusted.
export type OfficeLine = { ipv4?: string; ipv6?: string; confirmed_on: string };
export type Office = { on?: boolean; lines?: OfficeLine[] };

// The roles the switch binds; the owner and partners reach the firm from anywhere.
export const officeBound = (role: string) => ["staff", "manager", "front_desk"].includes(role);

// The address a request came from, read only from the header the host vouches for:
// Cloudflare's CF-Connecting-IP (OFFICE_IP_HEADER names another, for the tests).
export const requestAddress = (headers: Headers) => headers.get(process.env.OFFICE_IP_HEADER ?? "cf-connecting-ip")?.trim() ?? "";

// "2001:db8:a:b" for any address in that /64, "" for anything that is not IPv6.
export function ipv6Prefix(address: string) {
  if (!address.includes(":")) return "";
  const [head, tail = ""] = address.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = address.includes("::") ? (tail ? tail.split(":") : []) : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return groups.length === 8 ? groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, "")).join(":") : "";
}

// The line an address would be recorded as.
export const lineFor = (address: string, today: string): OfficeLine | null =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(address) ? { ipv4: address, confirmed_on: today } : ipv6Prefix(address) ? { ipv6: ipv6Prefix(address), confirmed_on: today } : null;

export const onOfficeLine = (address: string, office: Office | undefined) =>
  !!address && (office?.lines ?? []).some((line) => (line.ipv4 && line.ipv4 === address) || (line.ipv6 && line.ipv6 === ipv6Prefix(address)));

// The proof the server sends with a staff member's requests from an office line: good for
// 5 minutes, for this person and session only. The database checks it (office_allows).
let key: Promise<string> | null = null;
export async function officeProof(userId: string, sessionId: string) {
  key ??= Promise.resolve(supabaseAdmin().rpc("office_proof_key")).then(({ data }) => String(data ?? ""));
  const until = Math.floor(Date.now() / 1000) + 300;
  return `${until}.${createHmac("sha256", await key).update(`${userId}:${sessionId}:${until}`).digest("hex")}`;
}
