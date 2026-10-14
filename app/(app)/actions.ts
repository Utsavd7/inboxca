"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assignmentRoles, canManageClients, checkClient, readKind, type ClientInput } from "@/src/lib/clients";
import { serverCrypto } from "@/src/lib/crypto";
import { DAYS, type Hours, type SpecialHours } from "@/src/lib/hours";
import { cleanNumber, numberKinds, panOfGstin, type NumberKind } from "@/src/lib/identifiers";
import { readSheet } from "@/src/lib/sheet";
import { log } from "@/src/lib/logger";
import { currentMember } from "@/src/lib/member";
import { invitableRoles } from "@/src/lib/roles";
import { IDLE_CHOICES, SESSION_CHOICES, SEEN_COOKIE, seenCookie } from "@/src/lib/session";
import { supabaseAdmin, supabaseAnonymous } from "@/src/lib/supabase";

export type InviteState = { error?: string; done?: string; values?: Record<string, string> };

const invitable = z.enum(invitableRoles);

// The owner adds a person with a role. A person new to InboxCA gets a sign in (no
// password, nothing to set up yet); everyone invited gets a sign in code by email and sees
// the invite once signed in.
export async function inviteMember(_prev: InviteState, form: FormData): Promise<InviteState> {
  const { supabase, membership } = await currentMember();
  const values = { email: String(form.get("email") ?? ""), role: String(form.get("role") ?? "staff") };
  if (membership?.role !== "owner") return { error: "Only the firm's owner can invite people.", values };
  const email = values.email.trim().toLowerCase();
  if (!z.email().safeParse(email).success) return { error: "Enter a valid email address.", values };
  const role = invitable.safeParse(form.get("role"));
  if (!role.success) return { error: "Choose a role.", values };

  const admin = supabaseAdmin();
  let { data: personId } = await admin.rpc("user_id_for_email", { address: email });
  if (!personId) {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) {
      log.error("invite.create_user_failed", { status: error?.status });
      return { error: "The invite could not be made. Try again in a minute.", values };
    }
    personId = data.user.id;
  }
  const { data: added } = await supabase.rpc("invite_member", {
    target_firm: membership.firmId,
    person: personId,
    new_role: role.data,
  });
  if (!added) return { error: `${email} is already on your firm's list.`, values };

  const origin = (await headers()).get("origin") ?? process.env.APP_BASE_URL ?? "";
  const { error } = await supabaseAnonymous().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/confirm` },
  });
  if (error) log.warn("invite.email_failed", { status: error.status });
  revalidatePath("/app/people");
  return { done: `Invited ${email}. They have an email with a sign in code.` };
}

// The owner's controls on each person: save a new role, remove, or bring back. The
// database checks that the caller is the owner and logs the change.
export async function manageMember(form: FormData) {
  const { supabase, membership } = await currentMember();
  if (!membership) return;
  const args = { target_firm: membership.firmId, person: String(form.get("person") ?? "") };
  const intent = form.get("intent");
  const role = invitable.safeParse(form.get("role"));
  if (intent === "remove") await supabase.rpc("remove_member", args);
  else if (intent === "restore") await supabase.rpc("restore_member", args);
  else if (role.success) await supabase.rpc("change_role", { ...args, new_role: role.data });
  revalidatePath("/app/people");
}

export async function joinFirm(form: FormData) {
  const { supabase } = await currentMember();
  await supabase.rpc("accept_invite", { target_firm: String(form.get("firm") ?? "") });
  redirect("/app");
}

// Settings → Office hours. The database logs every change to the firm's settings.
export async function saveHours(form: FormData) {
  const { supabase, membership } = await currentMember();
  if (membership?.role !== "owner") redirect("/app");
  const hours: Hours = {};
  for (const day of DAYS.keys()) {
    if (!form.get(`open-${day}`)) continue;
    const [from, to] = [form.get(`from-${day}`), form.get(`to-${day}`)].map(String);
    if (!/^\d\d:\d\d$/.test(from) || !/^\d\d:\d\d$/.test(to) || from >= to)
      redirect(`/app/settings?error=${DAYS[day]}`);
    hours[day] = [from, to];
  }
  const { settings } = membership;
  const access = { ...(settings.access as object), hours_only: form.get("hours_only") === "on" };
  await supabase.from("firms").update({ settings: { ...settings, hours, access } }).eq("id", membership.firmId);
  redirect("/app/settings?saved=hours");
}

export async function changeHoliday(form: FormData) {
  const { supabase, membership } = await currentMember();
  if (membership?.role !== "owner") redirect("/app");
  const date = String(form.get("date") ?? "");
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) redirect("/app/settings");
  const current = (membership.settings.holidays as string[] | undefined) ?? [];
  const holidays =
    form.get("intent") === "remove" ? current.filter((day) => day !== date) : [...new Set([...current, date])].sort();
  await supabase.from("firms").update({ settings: { ...membership.settings, holidays } }).eq("id", membership.firmId);
  revalidatePath("/app/settings");
}

// Settings → Signing in: the idle and session limits (0 is off).
export async function saveLimits(form: FormData) {
  const { supabase, membership } = await currentMember();
  if (membership?.role !== "owner") redirect("/app");
  const whole = (name: string, allowed: number[]) => {
    const value = Number(form.get(name));
    return allowed.includes(value) && value ? value : undefined;
  };
  const access = {
    ...(membership.settings.access as object),
    idle_minutes: whole("idle_minutes", IDLE_CHOICES),
    session_hours: whole("session_hours", SESSION_CHOICES),
  };
  await supabase.from("firms").update({ settings: { ...membership.settings, access } }).eq("id", membership.firmId);
  redirect("/app/settings?saved=limits");
}

// The idle timer calls this while the person is active, so the server knows too.
export async function stillHere() {
  const { userId } = await currentMember();
  (await cookies()).set(SEEN_COOKIE, seenCookie(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

// Settings → Special hours: a date range with its own times (a tax season, a late evening).
export async function changeSpecialHours(form: FormData) {
  const { supabase, membership } = await currentMember();
  if (membership?.role !== "owner") redirect("/app");
  const [from, to, open, close] = ["from", "to", "open", "close"].map((name) => String(form.get(name) ?? ""));
  const current = (membership.settings.special_hours as SpecialHours[] | undefined) ?? [];
  let special: SpecialHours[];
  if (form.get("intent") === "remove") special = current.filter((range) => range.from !== from || range.to !== to);
  else {
    const day = /^\d{4}-\d\d-\d\d$/;
    const time = /^\d\d:\d\d$/;
    if (!day.test(from) || !day.test(to) || from > to || !time.test(open) || !time.test(close) || open >= close)
      redirect("/app/settings?error=special");
    special = [...current, { from, to, open, close }].sort((a, b) => a.from.localeCompare(b.from));
  }
  await supabase.from("firms").update({ settings: { ...membership.settings, special_hours: special } }).eq("id", membership.firmId);
  revalidatePath("/app/settings");
}

// On an error the form gets back what was typed, since React clears it after an action.
export type ClientState = { error?: string; values?: Record<string, string> };

// A client ready for add_clients: a new id, and its numbers encrypted with the firm's key,
// bound to that id, with blind indexes.
async function sealClient(firm: string, client: ClientInput) {
  const id = randomUUID();
  const crypto = serverCrypto();
  const numbers = [
    ["pan", client.pan, null],
    ["gstin", client.gstin, client.gstin.slice(0, 2)],
  ].filter(([, number]) => number) as [string, string, string | null][];
  const registrations = await Promise.all(
    numbers.map(async ([kind, number, state_code]) => ({
      kind,
      number_enc: await crypto.encrypt(firm, `clients/${id}/${kind}`, number),
      number_bidx: await crypto.blindIndex(firm, kind, number),
      state_code,
    })),
  );
  const email = client.email
    ? { email_enc: await crypto.encrypt(firm, `clients/${id}/email`, client.email), email_bidx: await crypto.blindIndex(firm, "email", client.email) }
    : {};
  return { id, name: client.name, kind: client.kind, ...email, registrations };
}

// Adds one client from the form.
export async function addClient(_prev: ClientState, form: FormData): Promise<ClientState> {
  const { supabase, membership } = await currentMember();
  const values = Object.fromEntries(["name", "kind", "pan", "gstin", "email"].map((field) => [field, String(form.get(field) ?? "")]));
  if (!membership || !canManageClients(membership.role))
    return { error: "Only the owner, a partner or a manager can add clients.", values };
  const checked = checkClient(values as ClientInput);
  if ("error" in checked) return { error: checked.error, values };
  const sealed = await sealClient(membership.firmId, checked.client);
  const { data, error } = await supabase.rpc("add_clients", { target_firm: membership.firmId, clients: [sealed] });
  if (error?.code === "23505") return { error: "A client with this PAN or GSTIN is already in your firm.", values };
  if (error || !data) return { error: "The client could not be added. Try again.", values };
  redirect(`/app/clients/${sealed.id}`);
}

export type ImportRow = ClientInput & { line: number; error?: string };
export type ImportState = { rows?: ImportRow[]; error?: string; done?: number };

// Column headings people use, as InboxCA reads them (any case).
const headings: Record<keyof ClientInput, string[]> = {
  name: ["name", "client name", "client", "party name"],
  kind: ["kind", "type", "client type", "constitution", "category"],
  pan: ["pan", "pan no", "pan number"],
  gstin: ["gstin", "gst", "gst no", "gst number", "gstin/uin"],
  email: ["email", "e-mail", "email id", "email address", "mail"],
};

// Import from a CSV or Excel file, in two passes: the first reads and checks every row and
// shows the problems; the second (with the checked rows) checks them again and adds the
// good ones in one batch. Rows with a problem are left out, never half added.
export async function importClients(_prev: ImportState, form: FormData): Promise<ImportState> {
  const { supabase, membership } = await currentMember();
  if (!membership || !canManageClients(membership.role))
    return { error: "Only the owner, a partner or a manager can import clients." };
  const firm = membership.firmId;
  const confirmed = form.get("rows");
  let rows: ImportRow[];
  if (confirmed) rows = (JSON.parse(String(confirmed)) as ImportRow[]).slice(0, 2000);
  else {
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return { error: "Choose a CSV or Excel file." };
    if (!/\.(csv|xlsx)$/i.test(file.name)) return { error: "Choose a .csv or .xlsx file. For an old .xls file, save it as .xlsx first." };
    let table: string[][];
    try {
      table = readSheet(Buffer.from(await file.arrayBuffer()), file.name);
    } catch {
      return { error: "That file could not be read. Save it again as .xlsx or .csv and try once more." };
    }
    const [header = [], ...body] = table;
    const at = Object.fromEntries(
      Object.entries(headings).map(([field, names]) => [field, header.findIndex((cell) => names.includes(cell.trim().toLowerCase()))]),
    ) as Record<keyof ClientInput, number>;
    if (at.name < 0) return { error: "The first row must name the columns, with one called Name or Client name." };
    if (body.length > 2000) return { error: "Import at most 2,000 clients at a time." };
    const cell = (cells: string[], field: keyof ClientInput) => (at[field] < 0 ? "" : (cells[at[field]] ?? "").trim());
    rows = body.map((cells, index) => ({
      line: index + 2,
      name: cell(cells, "name"),
      kind: cell(cells, "kind"),
      pan: cell(cells, "pan"),
      gstin: cell(cells, "gstin"),
      email: cell(cells, "email"),
    }));
  }

  // Each row on its own, then numbers repeated in the file, then numbers already in the firm.
  const seen = new Set<string>();
  const checked: ImportRow[] = rows.map((row) => {
    const kind = readKind(row.kind, !!cleanNumber(row.gstin));
    if (!kind) return { ...row, error: `"${row.kind}" is not a kind InboxCA knows. Use Individual, Business, Company, LLP or Trust.` };
    const result = checkClient({ ...row, kind });
    if ("error" in result) return { ...row, error: result.error };
    const numbers = [result.client.pan, result.client.gstin].filter(Boolean);
    if (numbers.some((number) => seen.has(number))) return { ...row, ...result.client, error: "The same PAN or GSTIN is on an earlier row." };
    numbers.forEach((number) => seen.add(number));
    return { line: row.line, ...result.client };
  });
  const crypto = serverCrypto();
  const lines = new Map<string, number>();
  for (const row of checked.filter((row) => !row.error))
    for (const [kind, number] of [["pan", row.pan], ["gstin", row.gstin]])
      if (number) lines.set(await crypto.blindIndex(firm, kind, number), row.line);
  const indexes = [...lines.keys()];
  for (let start = 0; start < indexes.length; start += 150) {
    const { data } = await supabase.from("client_registrations").select("number_bidx").in("number_bidx", indexes.slice(start, start + 150));
    for (const { number_bidx } of data ?? []) {
      const row = checked.find((candidate) => candidate.line === lines.get(number_bidx));
      if (row) row.error = "A client with this PAN or GSTIN is already in your firm.";
    }
  }
  if (!confirmed) return { rows: checked };

  const ready = checked.filter((row) => !row.error);
  const clients = await Promise.all(ready.map((row) => sealClient(firm, row)));
  const { data, error } = await supabase.rpc("add_clients", { target_firm: firm, clients });
  if (error || !data) return { rows: checked, error: "The import did not go through, and nothing was added. Try again." };
  revalidatePath("/app/clients");
  return { done: data };
}

// Every change on a client's page: its name and kind, a number added or removed, archived
// or restored. Row level security allows only the owner, a partner or a manager, and a
// trigger logs each change.
export async function manageClient(form: FormData) {
  const { supabase, membership } = await currentMember();
  const id = String(form.get("client") ?? "");
  const back = (error?: string) => redirect(`/app/clients/${id}${error ? `?error=${error}` : ""}`);
  if (!membership || !canManageClients(membership.role)) back("role");
  const firm = membership!.firmId;
  const intent = form.get("intent");

  if (intent === "details") {
    const checked = checkClient({ name: String(form.get("name") ?? ""), kind: String(form.get("kind") ?? ""), pan: "", gstin: "", email: String(form.get("email") ?? "") });
    if ("error" in checked) back("details");
    const { name, kind, email } = (checked as { client: ClientInput }).client;
    const crypto = serverCrypto();
    await supabase
      .from("clients")
      .update({
        name,
        kind,
        email_enc: email ? await crypto.encrypt(firm, `clients/${id}/email`, email) : null,
        email_bidx: email ? await crypto.blindIndex(firm, "email", email) : null,
      })
      .eq("id", id);
  } else if (intent === "archive" || intent === "restore") {
    await supabase.from("clients").update({ archived_at: intent === "archive" ? new Date().toISOString() : null }).eq("id", id);
  } else if (intent === "assign") {
    const role = String(form.get("role") ?? "");
    if (!(role in assignmentRoles)) back("assign");
    const { error } = await supabase
      .from("client_assignments")
      .insert({ firm_id: firm, client_id: id, user_id: String(form.get("person") ?? ""), role });
    if (error) back(error.code === "23505" ? "assigned" : "assign");
  } else if (intent === "unassign") {
    await supabase.from("client_assignments").delete().eq("client_id", id).eq("user_id", String(form.get("person") ?? ""));
  } else if (intent === "remove-number") {
    await supabase.from("client_registrations").delete().eq("id", String(form.get("registration") ?? ""));
  } else if (intent === "add-number") {
    const kind = String(form.get("kind") ?? "") as NumberKind;
    const number = cleanNumber(String(form.get("number") ?? ""));
    if (!(kind in numberKinds) || !numberKinds[kind].valid(number)) back("number");
    // One PAN per client, and every GSTIN must hold that PAN.
    const crypto = serverCrypto();
    const { data: own } = await supabase.from("client_registrations").select("kind, number_enc").eq("client_id", id);
    const pans = await Promise.all(
      (own ?? []).filter((row) => row.kind === "pan").map((row) => crypto.decrypt(firm, `clients/${id}/pan`, row.number_enc)),
    );
    if (kind === "pan" && pans.length) back("one-pan");
    if (kind === "gstin" && pans.length && !pans.includes(panOfGstin(number))) back("gstin-pan");
    const { error } = await supabase.from("client_registrations").insert({
      firm_id: firm,
      client_id: id,
      kind,
      number_enc: await crypto.encrypt(firm, `clients/${id}/${kind}`, number),
      number_bidx: await crypto.blindIndex(firm, kind, number),
      state_code: kind === "gstin" ? number.slice(0, 2) : null,
    });
    if (error) back(error.code === "23505" ? "taken" : "number");
  }
  back();
}

// Settings → Who sees which clients: everyone (open) or only those assigned (restricted).
export async function saveVisibility(form: FormData) {
  const { supabase, membership } = await currentMember();
  if (membership?.role !== "owner") redirect("/app");
  const client_visibility = form.get("visibility") === "restricted" ? "restricted" : "open";
  await supabase.from("firms").update({ settings: { ...membership.settings, client_visibility } }).eq("id", membership.firmId);
  redirect("/app/settings?saved=visibility");
}
