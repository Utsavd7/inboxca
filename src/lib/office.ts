import { isIP } from "node:net";
import { createHmac } from "node:crypto";
import { cookies, headers } from "next/headers";
import { DEVICE_COOKIE, deviceHash, deviceName } from "./device";
import { supabaseAdmin } from "./supabase";

// The office connection (PLAN.md 5.8, 5.17.3): the office's public internet address as the
// server sees it. IPv4 is matched exactly, IPv6 by its /64 prefix. A firm may have several
// lines. Nothing a PC says about itself is trusted.
export type OfficeLine = { id?: string; ipv4?: string; ipv6?: string; confirmed_on: string; seen_on?: string; until?: string; fixed?: boolean };
export type Office = { on?: boolean; lines?: OfficeLine[]; deputies?: string[] };
export const officeApprover = (role: string, userId: string, settings: Record<string, unknown>) =>
  role === "owner" || role === "partner" && ((settings.office as Office | undefined)?.deputies ?? []).includes(userId);

// The roles the switch binds; the owner and partners reach the firm from anywhere.
export const officeBound = (role: string) => ["staff", "manager", "front_desk"].includes(role);

// The address a request came from, read only from the header the host vouches for:
// Cloudflare's CF-Connecting-IP (OFFICE_IP_HEADER names another, for the tests).
export const requestAddress = (headers: Headers) => headers.get(process.env.OFFICE_IP_HEADER || "cf-connecting-ip")?.trim() ?? "";

// "2001:db8:a:b" for any address in that /64, "" for anything that is not IPv6.
export function ipv6Prefix(address: string) {
  if (isIP(address) !== 6) return "";
  const [head, tail = ""] = address.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = address.includes("::") ? (tail ? tail.split(":") : []) : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return groups.length === 8 ? groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, "")).join(":") : "";
}

// The line an address would be recorded as.
export const lineFor = (address: string, today: string): OfficeLine | null =>
  isIP(address) === 4 ? { ipv4: address, confirmed_on: today } : ipv6Prefix(address) ? { ipv6: ipv6Prefix(address), confirmed_on: today } : null;

// Only host supplied addresses can teach a line. A browser cannot supply the other half.
export function requestLine(request: Headers, today: string) {
  const line = lineFor(requestAddress(request), today);
  // Cloudflare's generated IPv4 is not the connection's real IPv4.
  if (!process.env.OFFICE_IP_HEADER && line?.ipv4 && Number(line.ipv4.split(".")[0]) >= 240) {
    return lineFor(request.get("cf-connecting-ipv6") ?? "", today);
  }
  // This optional second header must be overwritten by the trusted host, like the first.
  const secondHeader = process.env.OFFICE_SECOND_IP_HEADER;
  const second = secondHeader ? lineFor(request.get(secondHeader)?.trim() ?? "", today) : null;
  if (line?.ipv4 && second?.ipv6 || line?.ipv6 && second?.ipv4) return { ...line, ...second };
  return line;
}

export function connectionRule(line: OfficeLine, office: Office, kind: string, now = Date.now()) {
  const known = office.lines?.find((saved) => (!saved.until || Date.parse(saved.until) > now) &&
    (line.ipv4 && saved.ipv4 === line.ipv4 || line.ipv6 && saved.ipv6 === line.ipv6));
  return known ? "known" : kind === "office" ? "fixed_pc" : "waiting";
}

export const onOfficeLine = (address: string, office: Office | undefined) => {
  const line = lineFor(address, "");
  return !!line && connectionRule(line, office ?? {}, "laptop") === "known";
};

// The server checks both the approved PC and its connection on every request.
export async function officeDeviceAccess(userId: string, observe = true) {
  const admin = supabaseAdmin();
  const { data: firmRow } = await admin.from("firm_members").select("firm_id, role, firms(settings)")
    .eq("user_id", userId).eq("status", "active").limit(1).maybeSingle();
  const office = (firmRow?.firms?.settings as { office?: Office } | undefined)?.office;
  const requestHeaders = await headers();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const line = requestLine(requestHeaders, today);
  let deviceStatus: "waiting" | "refused" | null = null;
  let approved = false;
  let connectionWaiting = false;
  let remoteUntil: string | null = null;
  if (office?.on && firmRow && officeBound(firmRow.role)) {
    const token = (await cookies()).get(DEVICE_COOKIE)?.value;
    let pc;
    if (token) {
      const digest = await deviceHash(token);
      if (observe && line && connectionRule(line, office, "laptop") === "known") {
        const { error } = await admin.rpc("register_device", {
          target_firm: firmRow.firm_id, actor: userId, token_digest: digest,
          label: deviceName(requestHeaders.get("user-agent") ?? ""),
        });
        if (error) throw new Error(`PC registration failed: ${error.code}`);
      }
      const { data, error } = await admin.from("devices").select("id, status, kind, person_id, ends_on")
        .eq("firm_id", firmRow.firm_id).eq("token_hash", digest).maybeSingle();
      if (error) throw new Error(`PC check failed: ${error.code}`);
      pc = data;
    }
    if (!observe) return { approved: false, deviceStatus: null, connectionWaiting: pc?.status === "approved" && !!line && connectionRule(line, office, "laptop") === "waiting", remoteUntil: null };
    // A personal device works anywhere for its one person until its end date, view only;
    // anyone else on it, or after that day, is refused.
    if (pc?.status === "approved" && pc.kind === "personal") {
      if (pc.person_id === userId && pc.ends_on! >= today) remoteUntil = pc.ends_on;
      else {
        deviceStatus = "refused";
        const { error } = await admin.rpc("office_refused", { target_firm: firmRow.firm_id, person: userId, reason: "pc" });
        if (error) throw new Error(`Office refusal failed: ${error.code}`);
      }
    } else if (pc?.status === "approved" && line) {
      const { data, error } = await admin.rpc("observe_office", {
        target_firm: firmRow.firm_id, person: userId, pc: pc.id, connection: line,
      });
      if (error) throw new Error(`Office check failed: ${error.code}`);
      approved = data === true;
      connectionWaiting = !approved;
    } else {
      deviceStatus = pc?.status === "refused" ? "refused" : pc || line && connectionRule(line, office, "laptop") === "known" ? "waiting" : null;
      const { error } = await admin.rpc("office_refused", { target_firm: firmRow.firm_id, person: userId, reason: "pc" });
      if (error) throw new Error(`Office refusal failed: ${error.code}`);
    }
  }
  return { approved, deviceStatus, connectionWaiting, remoteUntil };
}

// A staff member away from the office asks to use this device there: it waits for the owner
// or a deputy, marked as first used away (5.17.4 #28, #48).
export async function askAway(userId: string) {
  const admin = supabaseAdmin();
  const { data: firmRow } = await admin.from("firm_members").select("firm_id, role, firms(settings)")
    .eq("user_id", userId).eq("status", "active").limit(1).maybeSingle();
  const token = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (!firmRow || !token || !(firmRow.firms?.settings as { office?: Office } | undefined)?.office?.on || !officeBound(firmRow.role)) return;
  const { error } = await admin.rpc("register_device", {
    target_firm: firmRow.firm_id, actor: userId, token_digest: await deviceHash(token),
    label: deviceName((await headers()).get("user-agent") ?? ""), away: true,
  });
  if (error) throw new Error(`PC registration failed: ${error.code}`);
}

// The proof the server sends with a staff member's requests from an office line: good for
// 5 minutes, for this person and session only. The database checks it (office_allows).
let key: Promise<string> | null = null;
export async function officeProof(userId: string, sessionId: string) {
  key ??= Promise.resolve(supabaseAdmin().rpc("office_proof_key")).then(({ data }) => String(data ?? ""));
  const until = Math.floor(Date.now() / 1000) + 300;
  return `${until}.${createHmac("sha256", await key).update(`${userId}:${sessionId}:${until}`).digest("hex")}`;
}
