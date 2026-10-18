"use server";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { todayInIndia } from "@/src/lib/calendar";
import type { Json } from "@/src/db/types";
import { checklists, type DocumentRequest } from "@/src/lib/checklists";
import { assignmentRoles, canManageClients, checkClient, readKind, type ClientInput } from "@/src/lib/clients";
import { serverCrypto } from "@/src/lib/crypto";
import { folderFor, periodChoices, periodName, placeUnderFreeName, receivedLabel } from "@/src/lib/documents";
import { DELETED_FOLDER, workTypes, type FolderOrder, type WorkType } from "@/src/lib/drive";
import { DRIVE_COOKIE, openDrive, saveDrive } from "@/src/lib/drive-account";
import { dropboxSignIn, pkce } from "@/src/lib/dropbox";
import { DAYS, type Hours, type SpecialHours } from "@/src/lib/hours";
import { cleanNumber, numberKinds, panOfGstin, type NumberKind } from "@/src/lib/identifiers";
import { recognisePortalFile } from "@/src/lib/portal-files";
import { readSheet } from "@/src/lib/sheet";
import { labels } from "@/src/lib/triage";
import { log } from "@/src/lib/logger";
import { checkMailbox, detectSettings, smtpTransport, type MailSettings } from "@/src/lib/mailbox";
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
  else if (role.success) {
    await supabase.rpc("change_role", { ...args, new_role: role.data });
    const group = (name: string) => String(form.get(name) ?? "") || null;
    await supabase
      .from("firm_members")
      .update({ team_id: group("team"), branch_id: group("branch") })
      .eq("firm_id", args.target_firm)
      .eq("user_id", args.person);
  }
  revalidatePath("/app/people");
}

// People → Teams and Branches: the owner adds and removes them. Removing a team leaves its
// people without a team and drops its client assignments; removing a branch clears it from
// its people and clients.
export async function changeGroup(form: FormData) {
  const { supabase, membership } = await currentMember();
  if (membership?.role !== "owner") redirect("/app");
  const kind = form.get("kind") === "branch" ? "branch" : "team";
  const name = String(form.get("name") ?? "").trim();
  if (form.get("intent") === "remove") await supabase.from("groups").delete().eq("id", String(form.get("group") ?? "")).eq("kind", kind);
  else if (name && name.length <= 120) await supabase.from("groups").insert({ firm_id: membership.firmId, kind, name });
  revalidatePath("/app/people");
}

export async function joinFirm(form: FormData) {
  const { supabase } = await currentMember();
  await supabase.rpc("accept_invite", { target_firm: String(form.get("firm") ?? "") });
  // The sidebar is in the layout, which a redirect alone does not redraw.
  revalidatePath("/app", "layout");
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
  const tab = String(form.get("tab") ?? "").replace(/[^a-z]/g, "");
  const back = (error?: string) => {
    const query = new URLSearchParams({ ...(tab && tab !== "overview" && { tab }), ...(error && { error }) }).toString();
    return redirect(`/app/clients/${id}${query ? `?${query}` : ""}`);
  };
  if (!membership || !canManageClients(membership.role)) back("role");
  const firm = membership!.firmId;
  const intent = form.get("intent");

  if (intent === "details") {
    const checked = checkClient({ name: String(form.get("name") ?? ""), kind: String(form.get("kind") ?? ""), pan: "", gstin: "", email: String(form.get("email") ?? "") });
    if ("error" in checked) back("details");
    const { name, kind, email } = (checked as { client: ClientInput }).client;
    // A group chosen from the list, or a new one named here.
    let group = String(form.get("group") ?? "") || null;
    const newGroup = String(form.get("new_group") ?? "").trim();
    if (newGroup) {
      const { data } = await supabase
        .from("groups")
        .insert({ firm_id: firm, kind: "client_group", name: newGroup.slice(0, 120) })
        .select("id")
        .single();
      group = data?.id ?? group;
    }
    const crypto = serverCrypto();
    await supabase
      .from("clients")
      .update({
        name,
        kind,
        group_id: group,
        branch_id: String(form.get("branch") ?? "") || null,
        email_enc: email ? await crypto.encrypt(firm, `clients/${id}/email`, email) : null,
        email_bidx: email ? await crypto.blindIndex(firm, "email", email) : null,
      })
      .eq("id", id);
  } else if (intent === "archive" || intent === "restore") {
    await supabase.from("clients").update({ archived_at: intent === "archive" ? new Date().toISOString() : null }).eq("id", id);
  } else if (intent === "assign") {
    const role = String(form.get("role") ?? "");
    // "team:<id>" or "person:<id>"
    const [kind, who] = String(form.get("who") ?? "").split(":");
    if (!(role in assignmentRoles) || !who || (kind !== "team" && kind !== "person")) back("assign");
    const { error } = await supabase
      .from("client_assignments")
      .insert({ firm_id: firm, client_id: id, role, ...(kind === "team" ? { team_id: who } : { user_id: who }) });
    if (error) back(error.code === "23505" ? "assigned" : "assign");
  } else if (intent === "unassign") {
    const [kind, who] = String(form.get("who") ?? "").split(":");
    await supabase.from("client_assignments").delete().eq("client_id", id).eq(kind === "team" ? "team_id" : "user_id", who);
  } else if (intent === "add-contact") {
    // A contact is found by email first, so one person acting for several clients is one contact.
    const name = String(form.get("contact_name") ?? "").trim();
    const email = String(form.get("contact_email") ?? "").trim().toLowerCase();
    if (!name || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) back("contact");
    const crypto = serverCrypto();
    const index = await crypto.blindIndex(firm, "email", email);
    let { data: contact } = await supabase.from("contacts").select("id").eq("email_bidx", index).maybeSingle();
    if (!contact) {
      const contactId = randomUUID();
      const { error } = await supabase.from("contacts").insert({
        id: contactId,
        firm_id: firm,
        name_enc: await crypto.encrypt(firm, `contacts/${contactId}/name`, name),
        email_enc: await crypto.encrypt(firm, `contacts/${contactId}/email`, email),
        email_bidx: index,
      });
      if (error) back("contact");
      contact = { id: contactId };
    }
    const { error } = await supabase.from("contact_clients").insert({
      firm_id: firm,
      contact_id: contact.id,
      client_id: id,
      relation: String(form.get("relation") ?? "").trim().slice(0, 60) || null,
      can_view_status: form.get("can_view_status") === "on",
      can_receive_documents: form.get("can_receive_documents") === "on",
    });
    if (error) back(error.code === "23505" ? "linked" : "contact");
  } else if (intent === "contact-rights") {
    await supabase
      .from("contact_clients")
      .update({ can_view_status: form.get("can_view_status") === "on", can_receive_documents: form.get("can_receive_documents") === "on" })
      .eq("client_id", id)
      .eq("contact_id", String(form.get("contact") ?? ""));
  } else if (intent === "unlink-contact") {
    await supabase.from("contact_clients").delete().eq("client_id", id).eq("contact_id", String(form.get("contact") ?? ""));
  } else if (intent === "services") {
    const services = form.getAll("service").map(String);
    const { error } = await supabase.from("client_registrations").update({ services }).eq("id", String(form.get("registration") ?? ""));
    if (error) back("services");
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

// Calendar: mark the chosen returns in progress, filed (with each one's acknowledgement
// number), or not filed after a mistake. Row level security limits it to clients the
// person may see; every change is logged.
export async function manageTasks(form: FormData) {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const intent = form.get("intent");
  const ids = form.getAll("task").map(String);
  await Promise.all(
    ids.map((id) => {
      const ack = String(form.get(`ack-${id}`) ?? "").trim().slice(0, 40);
      const change =
        intent === "filed"
          ? { status: "filed", details: { filed_on: todayInIndia(), ...(ack && { ack }) } }
          : intent === "in_progress"
            ? { status: "in_progress" }
            : { status: "upcoming", details: {} };
      return supabase.from("tasks").update(change).eq("id", id);
    }),
  );
  revalidatePath("/app", "layout");
}

export type MailboxState = { error?: string; values?: Record<string, string> };
const mailboxErrors = {
  invalid: "Enter the firm's email address and its password.",
  microsoft: "This address is on Outlook or Microsoft 365, which connects with Microsoft sign in. That is coming soon.",
  sign_in: "InboxCA could not sign in with that address and password. Check the password, or use an app password.",
  server: "InboxCA could not reach the mail server. Check the server settings below.",
};

// Settings → Firm email: the owner connects the firm's mailbox. Both sign ins are checked
// first; the address and password are saved encrypted with the firm's key.
export async function connectMailbox(_prev: MailboxState, form: FormData): Promise<MailboxState> {
  const { supabase, membership } = await currentMember();
  if (membership?.role !== "owner") redirect("/app");
  const values = Object.fromEntries(["address", "imap_host", "imap_port", "smtp_host", "smtp_port"].map((key) => [key, String(form.get(key) ?? "").trim()]));
  const address = values.address.toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!z.email().safeParse(address).success || !password) return { error: mailboxErrors.invalid, values };
  const typed = values.imap_host && values.smtp_host;
  const settings = typed
    ? { imap: { host: values.imap_host, port: Number(values.imap_port) || 993 }, smtp: { host: values.smtp_host, port: Number(values.smtp_port) || 465 } }
    : await detectSettings(address);
  if (settings === "microsoft") return { error: mailboxErrors.microsoft, values };
  const checked = await checkMailbox(address, password, settings);
  if ("error" in checked) return { error: mailboxErrors[checked.error], values: { ...values, ...serverValues(settings) } };

  const id = randomUUID();
  const crypto = serverCrypto();
  const { error } = await supabase.from("connected_accounts").insert({
    id,
    firm_id: membership.firmId,
    kind: "mail",
    provider: "imap",
    address_enc: await crypto.encrypt(membership.firmId, `accounts/${id}/address`, address),
    credentials_enc: await crypto.encrypt(membership.firmId, `accounts/${id}/credentials`, JSON.stringify({ password })),
    sync_cursor: checked.cursor,
    settings,
  });
  if (error) return { error: "A mailbox is already connected. Disconnect it first.", values };
  revalidatePath("/app/settings");
  return {};
}
const serverValues = ({ imap, smtp }: { imap: { host: string; port: number }; smtp: { host: string; port: number } }) => ({
  imap_host: imap.host,
  imap_port: String(imap.port),
  smtp_host: smtp.host,
  smtp_port: String(smtp.port),
});

// Disconnecting deletes the saved password at once, so nothing more is read or sent.
export async function disconnectMailbox() {
  const { supabase, membership } = await currentMember();
  if (membership?.role !== "owner") redirect("/app");
  await supabase.from("connected_accounts").delete().eq("firm_id", membership.firmId).eq("kind", "mail");
  revalidatePath("/app/settings");
}

// Inbox: correct an email's label (a person's choice wins over the rules and is logged), or
// mark a Needs team reply request done once someone has replied from the mailbox.
export async function manageEmail(form: FormData) {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const label = String(form.get("label") ?? "");
  if (form.get("intent") === "label" && label in labels)
    await supabase.from("email_events").update({ label, decision_source: "staff" }).eq("id", String(form.get("email") ?? ""));
  else if (form.get("intent") === "done") await supabase.from("requests").update({ status: "done" }).eq("id", String(form.get("request") ?? ""));
  // The sidebar's Inbox count is in the layout.
  revalidatePath("/app", "layout");
}

// Settings → Firm drive: the owner connects the firm's drive after ticking the Drive
// access terms. Dropbox signs in on its own page (the callback finishes in
// /api/drive/callback); the test drive exists only where the server has one.
export async function connectDrive(form: FormData) {
  const { supabase, membership } = await currentMember();
  if (membership?.role !== "owner") redirect("/app");
  const provider = String(form.get("provider") ?? "");
  if (form.get("agree") !== "on") redirect("/app/settings?error=drive_terms#drive");
  if (provider === "dropbox" && process.env.DROPBOX_APP_KEY) {
    const { verifier, challenge } = pkce();
    const state = randomUUID();
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
    (await cookies()).set(DRIVE_COOKIE, Buffer.from(JSON.stringify({ state, verifier })).toString("base64url"), {
      httpOnly: true,
      secure: origin.startsWith("https"),
      sameSite: "lax",
      maxAge: 600,
      path: "/api/drive",
    });
    redirect(dropboxSignIn(state, challenge, `${origin}/api/drive/callback`));
  }
  if (provider !== "local" || !process.env.DRIVE_LOCAL_DIR) redirect("/app/settings?error=drive_provider#drive");
  const { error } = await saveDrive(supabase, membership.firmId, "local", "Test drive on this computer", "{}");
  if (error) redirect(`/app/settings?error=${error}#drive`);
  revalidatePath("/app/settings");
}

// Disconnecting deletes InboxCA's access at once; the files stay in the firm's drive.
export async function disconnectDrive() {
  const { supabase, membership } = await currentMember();
  if (membership?.role !== "owner") redirect("/app");
  await supabase.from("connected_accounts").delete().eq("firm_id", membership.firmId).eq("kind", "drive");
  revalidatePath("/app/settings");
}

// The search palette: the firm's current clients whose name matches, as many as fit a list.
export async function findClients(text: string) {
  const { supabase, membership } = await currentMember();
  const q = text.trim().slice(0, 80);
  if (!membership || !q) return [];
  const { data } = await supabase
    .from("clients")
    .select("id, name, kind")
    .is("archived_at", null)
    .ilike("name", `%${q.replace(/[\\%_]/g, "\\$&")}%`)
    .order("name")
    .limit(8);
  return data ?? [];
}

// The type, work and period a person chose for a file, or null when they do not fit.
function documentValues(form: FormData) {
  const type = form.get("type") === "Other" ? String(form.get("custom") ?? "").trim() : String(form.get("type") ?? "");
  const work = String(form.get("work") ?? "");
  const period = String(form.get("period") ?? "");
  if (!type || type.length > 80 || !(work in workTypes) || (period && !periodChoices(todayInIndia()).includes(period))) return null;
  return { work_type: work as WorkType, document_type: type, period_key: period };
}

// The firm's drive and its folder order, or null when no drive is connected.
async function firmDrive(firmId: string) {
  const { data: account } = await supabaseAdmin().from("connected_accounts").select("id, provider, credentials_enc, settings").eq("firm_id", firmId).eq("kind", "drive").maybeSingle();
  if (!account) return null;
  return { drive: await openDrive(firmId, account), order: ((account.settings as { folder_order?: FolderOrder }).folder_order ?? "year_client_work") as FolderOrder };
}

// A document the person may see, with what moving it needs; the server reads where it is.
async function visibleDocument(form: FormData) {
  const { supabase, userId, membership } = await currentMember();
  const id = String(form.get("document") ?? "");
  const { data: visible } = await supabase.from("documents").select("id, client_id").eq("id", id).maybeSingle();
  if (!membership || !visible) redirect("/app");
  const back = `/app/clients/${visible.client_id}?tab=files`;
  const [{ data: document }, opened] = await Promise.all([
    supabaseAdmin().from("documents").select("work_type, document_type, period_key, status, name, drive_file_id, received_at, clients(name)").eq("id", id).single(),
    firmDrive(membership.firmId),
  ]);
  if (!document?.clients || !opened) redirect(`${back}&error=drive`);
  return { id, userId, membership, back, document, client: document.clients.name, ...opened };
}

// The last place a document had before a change of the given kind, from the log.
async function placeBefore(firmId: string, id: string, action: string) {
  const { data: entry } = await supabaseAdmin().from("activity_log").select("details").eq("firm_id", firmId).eq("entity_id", id).eq("action", action).order("at", { ascending: false }).limit(1).maybeSingle();
  return (entry?.details as { from?: Record<string, string> } | undefined)?.from;
}

// Confirms or corrects a filed document's type, work and period, or puts back the last
// change (M4 step 4). It is a rename, which every member may make (5.17.2). The file moves
// in the drive first, to the folder and name its values give, never over another file;
// rename_document then records the new place and logs the old one for Undo.
export async function manageDocument(form: FormData) {
  const { id, userId, membership, back, document, client, drive, order } = await visibleDocument(form);
  type Values = { work_type: string; document_type: string; period_key: string; status: string; name?: string };
  let next: Values;
  if (form.get("intent") === "undo") {
    const from = await placeBefore(membership.firmId, id, "document.renamed");
    if (!from) redirect(back);
    next = from as Values;
  } else {
    const values = documentValues(form);
    if (!values) redirect(`${back}&edit=${id}&error=document`);
    next = { ...values, status: "filed" };
  }
  if (next.work_type === document.work_type && next.document_type === document.document_type && next.period_key === document.period_key && next.status === document.status) redirect(back);

  const folder = await drive.ensureFolder(folderFor(order, client, { work: next.work_type as WorkType, period: next.period_key, receivedAt: document.received_at, toCheck: next.status === "to_check" }));
  const place = (name: string) => drive.move(document.drive_file_id, folder, name);
  // Undo tries the name the file had before; otherwise the plain name, then a free one.
  const before = next.name ? await place(next.name) : "taken";
  const placed =
    before !== "taken"
      ? { id: before.id, name: next.name! }
      : await placeUnderFreeName({ client, type: next.document_type, period: periodName(next.period_key), extension: path.extname(document.name) }, receivedLabel(document.received_at), place);
  if (placed === "taken") redirect(`${back}&error=drive`);
  await supabaseAdmin().rpc("rename_document", {
    target: id,
    actor: userId,
    new_work: next.work_type,
    new_type: next.document_type,
    new_period: next.period_key,
    new_status: next.status,
    new_name: placed.name,
    new_file: placed.id,
  });
  revalidatePath("/app", "layout");
  redirect(`${back}&renamed=${id}`);
}

// Saves a file a person brought into the client's folder in the drive and records it,
// logged with who did it. Refuses a file the client already has.
async function saveForClient(
  membership: { firmId: string },
  userId: string | null,
  client: { id: string; name: string },
  values: { work_type: WorkType; document_type: string; period_key: string; status: "filed" | "to_check" },
  file: { name: string; bytes: Uint8Array },
  opened: NonNullable<Awaited<ReturnType<typeof firmDrive>>>,
) {
  const admin = supabaseAdmin();
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const { data: twin } = await admin.from("documents").select("id").eq("client_id", client.id).eq("sha256", sha256).neq("status", "deleted").limit(1);
  if (twin?.length) return "twin" as const;
  const now = new Date().toISOString();
  const folder = await opened.drive.ensureFolder(folderFor(opened.order, client.name, { work: values.work_type, period: values.period_key, receivedAt: now, toCheck: values.status === "to_check" }));
  const placed = await placeUnderFreeName(
    { client: client.name, type: values.document_type, period: periodName(values.period_key), extension: path.extname(file.name) },
    receivedLabel(now),
    (name) => opened.drive.save(folder, name, file.bytes),
  );
  if (placed === "taken") return "drive" as const;
  const id = randomUUID();
  await admin.from("documents").insert({
    id,
    firm_id: membership.firmId,
    client_id: client.id,
    ...values,
    drive_file_id: placed.id,
    name: placed.name,
    original_name_enc: await serverCrypto().encrypt(membership.firmId, `documents/${id}/original_name`, file.name),
    size: file.bytes.length,
    sha256,
    received_at: now,
  });
  await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "document.uploaded", entity_type: "document", entity_id: id });
  return { id };
}

const MAX_UPLOAD = 25 * 1024 * 1024;

// A file the owner, a partner or a manager uploads for a client, typed by them, saved into
// the client's folder in the drive like a file from mail (PLAN.md 5.3). Up to 25 MB until
// the file worker takes larger files. A file the client already has is refused.
export async function uploadDocument(form: FormData) {
  const { supabase, userId, membership } = await currentMember();
  const { data: client } = await supabase.from("clients").select("id, name").eq("id", String(form.get("client") ?? "")).maybeSingle();
  if (!membership || !client) redirect("/app");
  const back = `/app/clients/${client.id}?tab=files`;
  if (!canManageClients(membership.role)) redirect(`${back}&error=role`);
  const values = documentValues(form);
  const file = form.get("file");
  if (!values || !(file instanceof File) || !file.size || file.size > MAX_UPLOAD) redirect(`${back}&upload=1&error=upload`);
  const opened = await firmDrive(membership.firmId);
  if (!opened) redirect(`${back}&error=drive`);
  const saved = await saveForClient(membership, userId, client, { ...values, status: "filed" }, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, opened);
  if (saved === "twin") redirect(`${back}&upload=1&error=twin`);
  if (saved === "drive") redirect(`${back}&error=drive`);
  revalidatePath("/app", "layout");
  redirect(`${back}&saved=${saved.id}`);
}

// Files staff fetched from the government portals, dropped in one or many at a time (PLAN.md
// 5.3.1, D39). Each is known by its own contents; the client comes from the GSTIN inside it
// and must be one the person may see. Every member may do this. A file that is not a known
// portal file is filed under the client's To check only when the owner, a partner or a
// manager drops it on that client's page; otherwise it is left out, and the summary says so.
export async function dropPortalFiles(form: FormData) {
  const { supabase, userId, membership } = await currentMember();
  if (!membership) redirect("/app");
  const onClient = String(form.get("client") ?? "");
  const back = onClient ? `/app/clients/${onClient}?tab=files&` : "/app?";
  const opened = await firmDrive(membership.firmId);
  if (!opened) redirect(`${back}error=drive`);
  const crypto = serverCrypto();
  const count = { filed: 0, again: 0, left: 0 };
  for (const file of form.getAll("files")) {
    if (!(file instanceof File) || !file.size) continue;
    if (file.size > MAX_UPLOAD) {
      count.left++;
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const portal = recognisePortalFile(bytes);
    const { data: registration } = portal
      ? await supabase.from("client_registrations").select("client_id, clients(id, name)").eq("kind", "gstin").eq("number_bidx", await crypto.blindIndex(membership.firmId, "gstin", portal.gstin)).maybeSingle()
      : { data: null };
    let saved: Awaited<ReturnType<typeof saveForClient>> | null = null;
    if (portal && registration?.clients) saved = await saveForClient(membership, userId, registration.clients, { work_type: "gst", document_type: portal.type, period_key: portal.period, status: "filed" }, { name: file.name, bytes }, opened);
    else if (onClient && canManageClients(membership.role)) {
      const { data: client } = await supabase.from("clients").select("id, name").eq("id", onClient).maybeSingle();
      if (client) saved = await saveForClient(membership, userId, client, { work_type: "other", document_type: "Document", period_key: "", status: "to_check" }, { name: file.name, bytes }, opened);
    }
    if (saved === "twin") count.again++;
    else if (saved && saved !== "drive") count.filed++;
    else count.left++;
  }
  revalidatePath("/app", "layout");
  redirect(`${back}dropped=${count.filed}-${count.again}-${count.left}`);
}

// The owner removes a file, or puts back one removed in the last 30 days (D18). A removed
// file moves to the drive's Deleted and old versions folder; the nightly purge sends it to
// the drive's bin after 30 days. Removing for staff and managers is a request (later).
export async function removeDocument(form: FormData) {
  const { id, userId, membership, back, document, client, drive, order } = await visibleDocument(form);
  if (membership.role !== "owner") redirect(`${back}&error=owner`);
  const restoring = form.get("intent") === "restore";
  if (restoring !== (document.status === "deleted")) redirect(back);
  const from = restoring ? await placeBefore(membership.firmId, id, "document.removed") : undefined;
  const status = restoring ? (from?.status ?? "filed") : "deleted";
  const folder = await drive.ensureFolder(
    restoring
      ? folderFor(order, client, { work: document.work_type as WorkType, period: document.period_key, receivedAt: document.received_at, toCheck: status === "to_check" })
      : [DELETED_FOLDER],
  );
  const place = (name: string) => drive.move(document.drive_file_id, folder, name);
  const wanted = restoring ? (from?.name ?? document.name) : document.name;
  const first = await place(wanted);
  const placed =
    first !== "taken"
      ? { id: first.id, name: wanted }
      : await placeUnderFreeName({ client, type: document.document_type, period: periodName(document.period_key), extension: path.extname(document.name) }, receivedLabel(document.received_at), place);
  if (placed === "taken") redirect(`${back}&error=drive`);
  await supabaseAdmin().rpc("remove_document", { target: id, actor: userId, new_status: status, new_name: placed.name, new_file: placed.id });
  revalidatePath("/app", "layout");
  redirect(restoring ? `${back}&saved=${id}` : `${back}&removed=${id}`);
}

// Asks a client for files for one period (PLAN.md 5.3.1, 8.6). Every member may. The client
// gets a private upload link, sent from the firm's own mailbox to the client's registered
// email when both exist; the link works for 30 days and only its hash is kept, so the
// person sees it once to send it themselves otherwise.
export async function askForDocuments(form: FormData) {
  const { supabase, userId, membership } = await currentMember();
  const { data: client } = await supabase.from("clients").select("id, name, email_enc").eq("id", String(form.get("client") ?? "")).maybeSingle();
  if (!membership || !client) redirect("/app");
  const back = `/app/clients/${client.id}?tab=files`;
  const period = String(form.get("period") ?? "");
  const named = form.getAll("item").map(String);
  const others = String(form.get("others") ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name && name.length <= 80);
  const items = [
    ...named.flatMap((value) => {
      const [work, type] = value.split(":");
      return work in workTypes && checklists[work as WorkType]?.includes(type) ? [{ type, work: work as WorkType, received: [] as string[] }] : [];
    }),
    ...others.map((type) => ({ type, work: "other" as WorkType, received: [] as string[] })),
  ];
  if (!items.length || items.length > 30 || (period && !periodChoices(todayInIndia()).includes(period))) redirect(`${back}&ask=1&error=ask`);
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const admin = supabaseAdmin();
  const { error } = await admin.from("requests").insert({
    id,
    firm_id: membership.firmId,
    kind: "documents",
    client_id: client.id,
    entity_type: "checklist",
    entity_id: id,
    expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    details: { period, items, link_hash: createHash("sha256").update(token).digest("hex") },
  });
  if (error) redirect(`${back}&ask=1&error=ask`);
  await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "request.created", entity_type: "request", entity_id: id });
  const link = `${process.env.APP_BASE_URL ?? (await headers()).get("origin") ?? ""}/u/${token}`;

  // Sent from the firm's mailbox to the client's registered address, if both are there.
  const { data: mailbox } = await admin.from("connected_accounts").select("id, address_enc, credentials_enc, settings, status").eq("firm_id", membership.firmId).eq("kind", "mail").maybeSingle();
  let sent = false;
  if (mailbox?.status === "connected" && client.email_enc) {
    const crypto = serverCrypto();
    const from = await crypto.decrypt(membership.firmId, `accounts/${mailbox.id}/address`, mailbox.address_enc);
    const { password } = JSON.parse(await crypto.decrypt(membership.firmId, `accounts/${mailbox.id}/credentials`, mailbox.credentials_enc));
    const to = await crypto.decrypt(membership.firmId, `clients/${client.id}/email`, client.email_enc);
    const when = period ? ` for ${periodName(period)}` : "";
    try {
      await smtpTransport(from, password, (mailbox.settings as MailSettings).smtp).sendMail({
        from: `${membership.firmName} <${from}>`,
        to,
        subject: `Documents needed${when}`,
        text: [
          `Dear ${client.name},`,
          "",
          `Please upload these documents${when}:`,
          ...items.map((item) => `- ${item.type}`),
          "",
          `Upload them here, no sign in needed: ${link}`,
          "The link works for 30 days.",
          "",
          membership.firmName,
        ].join("\n"),
      });
      sent = true;
    } catch (failure) {
      log.warn("request_mail_failed", { code: (failure as { code?: string }).code ?? "send" });
    }
  }
  revalidatePath("/app", "layout");
  // The link is shown once, in the address, only when it could not be emailed.
  redirect(sent ? `${back}&asked=sent` : `${back}&asked=${encodeURIComponent(link)}`);
}

// A file the client uploads through their private link, against one item asked for. The
// link must be current and the request still open. Up to 25 MB a file and 100 files a request.
export async function uploadToRequest(form: FormData) {
  const token = String(form.get("token") ?? "");
  const back = `/u/${token}`;
  const admin = supabaseAdmin();
  const { data: request } = await admin
    .from("requests")
    .select("id, firm_id, client_id, status, expires_at, details, clients(id, name), firms(name)")
    .eq("kind", "documents")
    .eq("details->>link_hash", createHash("sha256").update(token).digest("hex"))
    .maybeSingle();
  if (!request?.clients || request.status !== "pending" || Date.parse(request.expires_at ?? "") < Date.now()) redirect(back);
  const details = request.details as unknown as DocumentRequest;
  const at = Number(form.get("item"));
  const item = details.items[at];
  const file = form.get("file");
  const total = details.items.reduce((sum, entry) => sum + entry.received.length, 0);
  if (!item || !(file instanceof File) || !file.size || file.size > MAX_UPLOAD || total >= 100) redirect(`${back}?error=file`);
  const opened = await firmDrive(request.firm_id);
  if (!opened) redirect(`${back}?error=later`);
  const saved = await saveForClient(
    { firmId: request.firm_id },
    null,
    request.clients,
    { work_type: item.work, document_type: item.type, period_key: details.period, status: "filed" },
    { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
    opened,
  );
  if (saved === "drive") redirect(`${back}?error=later`);
  if (saved !== "twin") item.received.push(saved.id);
  const done = details.items.every((entry) => entry.received.length > 0);
  await admin.from("requests").update({ details: details as unknown as NonNullable<Json>, status: done ? "done" : "pending" }).eq("id", request.id);
  redirect(`${back}?got=${at}`);
}
