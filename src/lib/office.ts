import { isIP } from "node:net";
import { createHmac } from "node:crypto";
import { cookies, headers } from "next/headers";
import { DEVICE_COOKIE, deviceHash, deviceName } from "./device";
import { supabaseAdmin } from "./supabase";

// The firm a person works in, for the checks that run before the database names it: the one
// they chose in the sidebar, else the first by id, as currentMember chooses (src/lib/member.ts).
export const FIRM_COOKIE = "inboxca_firm";
export async function chosenFirm<T extends { firm_id: string }>(rows: T[] | null) {
  const chosen = (await cookies()).get(FIRM_COOKIE)?.value;
  return rows?.find((row) => row.firm_id === chosen) ?? rows?.[0] ?? null;
}

// The office connection (PLAN.md 5.8, 5.17.3): the office's public internet address as the
// server sees it. IPv4 is matched exactly, IPv6 by its /64 prefix. A firm may have several
// lines. Nothing a PC says about itself is trusted.
export type OfficeLine = { id?: string; ipv4?: string; ipv6?: string; confirmed_on: string; seen_on?: string; until?: string; fixed?: boolean };
// anywhere: Remote friendly's approved devices, used from any connection (5.17).
export type Office = { on?: boolean; lines?: OfficeLine[]; deputies?: string[]; co_admin?: string | null; away?: boolean; anywhere?: boolean };
export const officeApprover = (role: string, userId: string, settings: Record<string, unknown>) =>
  role === "owner" || role === "partner" && ((settings.office as Office | undefined)?.deputies ?? []).includes(userId);
// The owner, or the deputy named co-admin, who also changes the access settings (5.17.4 #22).
export const firmAdmin = (role: string, userId: string, settings: Record<string, unknown>) =>
  role === "owner" || officeApprover(role, userId, settings) && (settings.office as Office | undefined)?.co_admin === userId;

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

// The host may also name the internet provider (OFFICE_PROVIDER_HEADER): kept on the line only
// for the admin console's view of office changes by provider (5.8), never to make an office.
function withProvider(line: OfficeLine | null, request: Headers) {
  const provider = process.env.OFFICE_PROVIDER_HEADER && request.get(process.env.OFFICE_PROVIDER_HEADER)?.trim().slice(0, 80);
  return line && provider ? { ...line, provider } : line;
}

// Only host supplied addresses can teach a line. A browser cannot supply the other half.
export function requestLine(request: Headers, today: string) {
  const line = lineFor(requestAddress(request), today);
  // Cloudflare's generated IPv4 is not the connection's real IPv4.
  if (!process.env.OFFICE_IP_HEADER && line?.ipv4 && Number(line.ipv4.split(".")[0]) >= 240) {
    return withProvider(lineFor(request.get("cf-connecting-ipv6") ?? "", today), request);
  }
  // This optional second header must be overwritten by the trusted host, like the first.
  const secondHeader = process.env.OFFICE_SECOND_IP_HEADER;
  const second = secondHeader ? lineFor(request.get(secondHeader)?.trim() ?? "", today) : null;
  if (line?.ipv4 && second?.ipv6 || line?.ipv6 && second?.ipv4) return withProvider({ ...line, ...second }, request);
  return withProvider(line, request);
}

// The fixed connection suggestion's thresholds (5.8), set in the admin console: after this
// many office confirmations in this many days. 3 in 14 until an admin changes them.
export async function fixedSuggestion() {
  const { data } = await supabaseAdmin().from("platform_settings").select("value").eq("key", "office").maybeSingle();
  const value = (data?.value ?? {}) as { fixed_taps?: number; fixed_days?: number };
  return { taps: value.fixed_taps ?? 3, days: value.fixed_days ?? 14 };
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

// A branch with its own office replaces the firm's switch and connections for its people
// (5.17, #13), as private.branch_settings does in the database.
const BRANCH = "branch:groups!firm_members_firm_id_branch_id_fkey(kind, settings)";
export const memberOffice = (office: Office | undefined, branch?: { kind: string; settings: unknown } | null): Office | undefined => {
  const own = branch?.kind === "branch" ? (branch.settings as { office?: Office }).office : undefined;
  return own ? { ...office, on: false, lines: [], anywhere: false, ...own } : office;
};

// A branch's own hours, holidays and special hours replace the firm's for its people, each
// on its own (private.branch_settings). Only for reading: never saved back to the firm.
export const HOURS_KEYS = ["hours", "holidays", "special_hours"] as const;
export const memberHours = (settings: Record<string, unknown>, branch?: { kind: string; settings: unknown } | null) => {
  const own = branch?.kind === "branch" ? (branch.settings ?? {}) as Record<string, unknown> : {};
  return { ...settings, ...Object.fromEntries(HOURS_KEYS.filter((key) => key in own).map((key) => [key, own[key]])) };
};

// The server checks both the approved PC and its connection on every request.
export async function officeDeviceAccess(userId: string, observe = true) {
  const admin = supabaseAdmin();
  const { data: rows } = await admin.from("firm_members").select(`firm_id, role, firms(settings), ${BRANCH}`)
    .eq("user_id", userId).eq("status", "active").order("firm_id").limit(20);
  const firmRow = await chosenFirm(rows);
  // The firm whose owner this login is, the chosen one first, for the owner's computers (D38).
  const ownerOf = (firmRow?.role === "owner" ? firmRow : rows?.find((row) => row.role === "owner"))?.firm_id ?? null;
  const office = memberOffice((firmRow?.firms?.settings as { office?: Office } | undefined)?.office, firmRow?.branch);
  const requestHeaders = await headers();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const line = requestLine(requestHeaders, today);
  let deviceStatus: "waiting" | "refused" | null = null;
  let approved = false;
  let connectionWaiting = false;
  let remoteUntil: string | null = null;
  // A PC that stays in the office: whether it still needs its own key, or has one to prove itself.
  let pcKey: "needed" | "ready" | null = null;
  if (office?.on && firmRow && officeBound(firmRow.role)) {
    const token = (await cookies()).get(DEVICE_COOKIE)?.value;
    let pc;
    if (token) {
      const digest = await deviceHash(token);
      // Under Remote friendly an approved device works anywhere, so a new one asks from anywhere.
      if (observe && (office.anywhere || line && connectionRule(line, office, "laptop") === "known")) {
        const { error } = await admin.rpc("register_device", {
          target_firm: firmRow.firm_id, actor: userId, token_digest: digest,
          label: deviceName(requestHeaders.get("user-agent") ?? ""),
        });
        if (error) throw new Error(`PC registration failed: ${error.code}`);
      }
      const { data, error } = await admin.from("devices").select("id, status, kind, person_id, ends_on, key_id")
        .eq("firm_id", firmRow.firm_id).eq("token_hash", digest).maybeSingle();
      if (error) throw new Error(`PC check failed: ${error.code}`);
      pc = data;
    }
    if (!observe) return { approved: false, deviceStatus: null, connectionWaiting: !office.anywhere && pc?.status === "approved" && !!line && connectionRule(line, office, "laptop") === "waiting", remoteUntil: null, pcKey: null, anywhere: !!office.anywhere };
    if (pc?.status === "approved" && pc.kind === "office" && !office.anywhere) pcKey = pc.key_id ? "ready" : "needed";
    // A personal device works anywhere for its one person until its end date, view only;
    // anyone else on it, after that day, or once the firm stops working away, is refused.
    if (pc?.status === "approved" && pc.kind === "personal") {
      if (pc.person_id === userId && pc.ends_on! >= today && office.away !== false) remoteUntil = pc.ends_on;
      else {
        deviceStatus = "refused";
        const { error } = await admin.rpc("office_refused", { target_firm: firmRow.firm_id, person: userId, reason: "pc" });
        if (error) throw new Error(`Office refusal failed: ${error.code}`);
      }
    } else if (pc?.status === "approved" && office.anywhere) {
      approved = true;
    } else if (pc?.status === "approved" && line) {
      const { data, error } = await admin.rpc("observe_office", {
        target_firm: firmRow.firm_id, person: userId, pc: pc.id, connection: line,
      });
      if (error) throw new Error(`Office check failed: ${error.code}`);
      approved = data === true;
      connectionWaiting = !approved;
    } else {
      deviceStatus = pc?.status === "refused" ? "refused" : pc || office.anywhere || line && connectionRule(line, office, "laptop") === "known" ? "waiting" : null;
      const { error } = await admin.rpc("office_refused", { target_firm: firmRow.firm_id, person: userId, reason: "pc" });
      if (error) throw new Error(`Office refusal failed: ${error.code}`);
    }
  }
  // With anywhere an approved device is no second proof, so the 2 step code is still asked.
  return { approved, deviceStatus, connectionWaiting, remoteUntil, pcKey, anywhere: !!office?.anywhere, ownerOf };
}

// This browser's approved PC in the person's firm, for its key.
export async function officePc(userId: string) {
  const admin = supabaseAdmin();
  const token = (await cookies()).get(DEVICE_COOKIE)?.value;
  const member = await chosenFirm((await admin.from("firm_members").select("firm_id").eq("user_id", userId).eq("status", "active").order("firm_id").limit(20)).data);
  if (!token || !member) return null;
  const { data: device } = await admin.from("devices").select("id, kind, key_id, key_public")
    .eq("firm_id", member.firm_id).eq("token_hash", await deviceHash(token)).eq("status", "approved").maybeSingle();
  return device?.kind === "office" ? { firmId: member.firm_id, device } : null;
}

// A staff member away from the office asks to use this device there: it waits for the owner
// or a deputy, marked as first used away (5.17.4 #28, #48).
export async function askAway(userId: string) {
  const admin = supabaseAdmin();
  const firmRow = await chosenFirm((await admin.from("firm_members").select(`firm_id, role, firms(settings), ${BRANCH}`)
    .eq("user_id", userId).eq("status", "active").order("firm_id").limit(20)).data);
  const token = (await cookies()).get(DEVICE_COOKIE)?.value;
  const office = memberOffice((firmRow?.firms?.settings as { office?: Office } | undefined)?.office, firmRow?.branch);
  // The Office only and Solo CA presets turn asking off (5.17).
  if (!firmRow || !token || !office?.on || office.away === false || !officeBound(firmRow.role)) return;
  const { error } = await admin.rpc("register_device", {
    target_firm: firmRow.firm_id, actor: userId, token_digest: await deviceHash(token),
    label: deviceName((await headers()).get("user-agent") ?? ""), away: true,
  });
  if (error) throw new Error(`PC registration failed: ${error.code}`);
}

// The proof the server sends with a staff member's requests from an office line: good for
// 5 minutes, for this person and session only. The database checks it (office_allows).
// An Orelu admin's passkey proof is the same for "admin:<id>", good for an hour (is_orelu_admin).
let key: Promise<string> | null = null;
export async function officeProof(userId: string, sessionId: string, seconds = 300) {
  key ??= Promise.resolve(supabaseAdmin().rpc("office_proof_key")).then(({ data }) => String(data ?? ""));
  const until = Math.floor(Date.now() / 1000) + seconds;
  return `${until}.${createHmac("sha256", await key).update(`${userId}:${sessionId}:${until}`).digest("hex")}`;
}
