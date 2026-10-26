"use server";
import { grantFor } from "@/src/lib/permission-grants";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ASK_DAYS, askChoices, STAGES } from "@/src/lib/reminders";
import { emailTemplates } from "@/src/lib/email-templates";
import { addDays, dueLabel, todayInIndia } from "@/src/lib/calendar";
import type { Json } from "@/src/db/types";
import { checklists, kindChecklist, receiveAsked, type DocumentRequest } from "@/src/lib/checklists";
import { assignmentRoles, canManageClients, checkClient, readKind, type ClientInput } from "@/src/lib/clients";
import { serverCrypto } from "@/src/lib/crypto";
import { describeFile, documentTypes, folderFor, gstinFor, periodChoices, periodName, placeUnderFreeName, receivedLabel, settleVersions, workOfType } from "@/src/lib/documents";
import { DELETED_FOLDER, folderOrders, incomingPath, namings, workTypes, type FolderOrder, type Naming, type WorkType } from "@/src/lib/drive";
import { DRIVE_COOKIE, openDrive, renewDrive, saveDrive } from "@/src/lib/drive-account";
import { dropboxSignIn, pkce } from "@/src/lib/dropbox";
import { DAYS, laterBy, SUGGESTED_HOURS, type Hours, type SpecialHours } from "@/src/lib/hours";
import { cleanNumber, numberKinds, panOfGstin, type NumberKind } from "@/src/lib/identifiers";
import { activeClients, importSince, inScope, planImport, type Planned, type Scope } from "@/src/lib/first-import";
import { authorities, noticeStatuses, reviewBy, type Authority, type NoticeDetails } from "@/src/lib/notices";
import { askAway, firmAdmin, memberHours, officeApprover, officePc, requestLine, type Office } from "@/src/lib/office";
import { presets, type Preset } from "@/src/lib/presets";
import { CHALLENGE_COOKIE, checkKeyUse, checkNewKey, newChallenge } from "@/src/lib/pc-key";
import { recognisePortalFile } from "@/src/lib/portal-files";
import { recognisePortalPdf } from "@/src/lib/tax-papers";
import { receive } from "@/src/lib/intake";
import { may, mayDecide, rightWords, routeOf, switchable, type Permissions, type Right, type Scope as PermissionScope, type Standing } from "@/src/lib/rights";
import { searchTokens, words } from "@/src/lib/search";
import { readSheet } from "@/src/lib/sheet";
import { queueRead } from "@/src/jobs/read-document";
import { runJobsSoon } from "@/src/jobs/run-soon";
import { labels } from "@/src/lib/triage";
import { log } from "@/src/lib/logger";
import { firmMailer, forgetMailToken, mailTokenForget } from "@/src/lib/firm-mail";
import { adminConsent, isMailApi, MAIL_COOKIE, mailSignIn, mailSignInReady } from "@/src/lib/mail-oauth";
import { mailboxLogin } from "@/src/lib/mailbox-login";
import { paperPolicy, type BulkSend, type RecordsSettings } from "@/src/lib/records";
import { sendShare } from "@/src/lib/shares";
import { checkMailbox, detectSettings, providerFor } from "@/src/lib/mailbox";
import { currentMember, currentWriter, FIRM_COOKIE, myQuestions } from "@/src/lib/member";
import { activityNames } from "@/src/lib/activity";
import { invitableRoles, personName } from "@/src/lib/roles";
import { IDLE_CHOICES, SESSION_CHOICES, SEEN_COOKIE, seenCookie, tellOwnerOnRepeat } from "@/src/lib/session";
import { supabaseAdmin, supabaseAnonymous } from "@/src/lib/supabase";
import { sendSystemMail } from "@/src/lib/system-mail";
import { keepSafetyCopy, openSafetyCopy } from "@/src/lib/workspace";

export type InviteState = { error?: string; done?: string; values?: Record<string, string> };

const invitable = z.enum(invitableRoles);

// The owner adds a person with a role. A person new to InboxCA gets a sign in (no
// password, nothing to set up yet); everyone invited gets a sign in code by email and sees
// the invite once signed in.
export async function inviteMember(_prev: InviteState, form: FormData): Promise<InviteState> {
  const { supabase, membership } = await currentWriter();
  const values = { email: String(form.get("email") ?? ""), role: String(form.get("role") ?? "staff") };
  if (membership?.role !== "owner") return { error: "Only the firm's owner can invite people.", values };
  const email = values.email.trim().toLowerCase();
  if (!z.email().safeParse(email).success) return { error: "Enter a valid email address.", values };
  if (await mailboxLogin(email, membership.firmId))
    return { error: "The firm's email address cannot be a team login.", values };
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
  // Orelu's system email names the firm, once it is set up (PLAN.md M0 step 8).
  await sendSystemMail(email, `${membership.firmName} added you on InboxCA`, [
    `${membership.firmName} uses InboxCA for its clients' papers and returns, and has added you to its team.`,
    `Sign in at ${origin}/sign-in with this email address. A sign in code comes in a separate email; there is no password.`,
    "If you did not expect this, you can ignore this email.",
  ].join("\n\n")).catch(() => log.warn("invite.system_mail_failed"));
  revalidatePath("/app/people");
  return { done: `Invited ${email}. They have an email with a sign in code.` };
}

// The owner's controls on each person: save a new role, remove, or bring back. The
// database checks that the caller is the owner and logs the change.
export async function manageMember(form: FormData) {
  const { supabase, membership } = await currentWriter();
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
  const { supabase, membership } = await currentWriter();
  if (membership?.role !== "owner") redirect("/app");
  const kind = form.get("kind") === "branch" ? "branch" : "team";
  const name = String(form.get("name") ?? "").trim();
  if (form.get("intent") === "remove") await supabase.from("groups").delete().eq("id", String(form.get("group") ?? "")).eq("kind", kind);
  else if (name && name.length <= 120) await supabase.from("groups").insert({ firm_id: membership.firmId, kind, name });
  revalidatePath("/app/people");
}

export async function joinFirm(form: FormData) {
  const { supabase } = await currentWriter();
  await supabase.rpc("accept_invite", { target_firm: String(form.get("firm") ?? "") });
  // The sidebar is in the layout, which a redirect alone does not redraw.
  revalidatePath("/app", "layout");
  redirect("/app");
}

// The branch a Settings → Hours form names (5.17.4 #13), if any: its hours, holidays and special
// hours as its people have them (the main office's where it has none of its own), and a save
// the database checks and logs (branch_hours).
async function hoursBranch(form: FormData, supabase: Awaited<ReturnType<typeof currentWriter>>["supabase"], firmId: string, settings: Record<string, unknown>, userId: string) {
  const branch = String(form.get("branch") ?? "");
  if (!branch) return null;
  const { data: group } = z.uuid().safeParse(branch).success
    ? await supabase.from("groups").select("kind, settings").eq("firm_id", firmId).eq("id", branch).eq("kind", "branch").maybeSingle()
    : { data: null };
  if (!group) redirect("/app/settings?group=hours");
  return {
    back: `/app/settings?group=hours&branch=${branch}`,
    settings: memberHours(settings, group),
    save: async (changes: Record<string, unknown>) => {
      const { error } = await supabaseAdmin().rpc("branch_hours", { target_firm: firmId, actor: userId, branch, changes: changes as Json });
      if (error) throw new Error(`Branch hours failed: ${error.code}`);
    },
  };
}

// Settings → Office hours. The database logs every change to the firm's settings.
export async function saveHours(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  if (!membership || !firmAdmin(membership.role, userId, membership.settings)) redirect("/app");
  const branch = await hoursBranch(form, supabase, membership.firmId, membership.settings, userId);
  const back = branch?.back ?? "/app/settings?group=hours";
  // The branch goes back to the main office's hours, holidays and special hours.
  if (branch && form.get("intent") === "follow") {
    await branch.save({ hours: null, holidays: null, special_hours: null });
    redirect(`${back}&saved=hours`);
  }
  const hours: Hours = {};
  for (const day of DAYS.keys()) {
    if (!form.get(`open-${day}`)) continue;
    const [from, to] = [form.get(`from-${day}`), form.get(`to-${day}`)].map(String);
    if (!/^\d\d:\d\d$/.test(from) || !/^\d\d:\d\d$/.test(to) || from >= to)
      redirect(`${back}&error=${DAYS[day]}`);
    hours[day] = [from, to];
  }
  // Whether office hours apply stays the firm's.
  if (branch) {
    await branch.save({ hours });
    redirect(`${back}&saved=hours`);
  }
  const { settings } = membership;
  const access = { ...(settings.access as object), hours_only: form.get("hours_only") === "on" };
  await supabase.from("firms").update({ settings: { ...settings, hours, access } }).eq("id", membership.firmId);
  redirect("/app/settings?group=hours&saved=hours");
}

export async function changeHoliday(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  if (!membership || !firmAdmin(membership.role, userId, membership.settings)) redirect("/app");
  const date = String(form.get("date") ?? "");
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) redirect("/app/settings?group=hours");
  const branch = await hoursBranch(form, supabase, membership.firmId, membership.settings, userId);
  const current = ((branch?.settings ?? membership.settings).holidays as string[] | undefined) ?? [];
  const holidays =
    form.get("intent") === "remove" ? current.filter((day) => day !== date) : [...new Set([...current, date])].sort();
  if (branch) await branch.save({ holidays });
  else await supabase.from("firms").update({ settings: { ...membership.settings, holidays } }).eq("id", membership.firmId);
  revalidatePath("/app/settings");
}

// Settings → Signing in: the idle and session limits (0 is off).
export async function saveLimits(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  if (!membership || !firmAdmin(membership.role, userId, membership.settings)) redirect("/app");
  const whole = (name: string, allowed: number[]) => {
    const value = Number(form.get(name));
    return allowed.includes(value) && value ? value : undefined;
  };
  const access = {
    ...(membership.settings.access as object),
    idle_minutes: whole("idle_minutes", IDLE_CHOICES),
    session_hours: whole("session_hours", SESSION_CHOICES),
    india_only: form.get("india_only") === "on" || undefined,
  };
  await supabase.from("firms").update({ settings: { ...membership.settings, access } }).eq("id", membership.firmId);
  redirect("/app/settings?group=access&saved=limits");
}

// Settings → Access preset (5.17): turns Office only on or off through the office checks,
// then sets asking to work away, office hours only and the idle limit.
export async function choosePreset(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  if (!membership || !firmAdmin(membership.role, userId, membership.settings)) redirect("/app");
  const key = String(form.get("preset") ?? "");
  if (!Object.hasOwn(presets, key)) redirect("/app/settings?group=access#preset");
  const preset = presets[key as Preset];
  const office = (membership.settings.office ?? {}) as Office;
  // From approved devices anywhere to an office preset, the office connection is asked again.
  const toOffice = preset.office && !preset.anywhere && (!office.on || !!office.anywhere);
  if (!!office.on !== preset.office || toOffice && form.get("here") === "yes") {
    const line = requestLine(await headers(), todayInIndia());
    const { error } = await supabaseAdmin().rpc("office_control", {
      target_firm: membership.firmId, actor: userId, decision: preset.office ? "on" : "off",
      ...(toOffice && form.get("here") === "yes" && line && { connection: line }),
    });
    if (error) throw new Error(`Office change failed: ${error.code}`);
  }
  const { data: firm } = await supabase.from("firms").select("settings").eq("id", membership.firmId).single();
  const settings = (firm?.settings ?? {}) as Record<string, unknown>;
  await supabase.from("firms").update({ settings: {
    ...settings,
    // Office hours only needs hours: the suggested ones until the owner sets them.
    hours: (settings.hours ?? SUGGESTED_HOURS) as Hours,
    office: { ...(settings.office as object), away: preset.away, anywhere: preset.anywhere || undefined },
    access: { ...(settings.access as object), hours_only: preset.hours_only, idle_minutes: preset.idle_minutes || undefined, india_only: preset.india_only || undefined },
  } }).eq("id", membership.firmId);
  revalidatePath("/app", "layout");
  redirect("/app/settings?group=access&saved=preset#preset");
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

// A person in two firms moves to the other one from the sidebar. Only one of their own firms
// open now is kept; currentMember then works in it, and the database shows it alone.
export async function switchFirm(firm: string) {
  const { membership } = await currentMember();
  if (membership?.firms.some((row) => row.id === firm))
    (await cookies()).set(FIRM_COOKIE, firm, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 365 * 86_400 });
  redirect("/app");
}

// Staying past closing (PLAN.md 5.17.4 #15): in the last 10 minutes a person bound by office
// hours may stay one more hour, once a day, logged; longer is a question for the owner.
export async function stayLater() {
  const { userId, membership } = await currentWriter();
  const closing = membership?.closing;
  if (!membership || !closing || closing.extended || Date.now() < closing.at - 10 * 60_000) redirect("/app");
  const until = laterBy(closing.close, 60);
  const admin = supabaseAdmin();
  await admin.from("firm_members").update({ access: { ...membership.access, extra_time: { day: closing.day, until } } }).eq("firm_id", membership.firmId).eq("user_id", userId);
  await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "hours.extended", entity_type: "user", entity_id: userId, details: { until } });
  revalidatePath("/app", "layout");
}

export async function askMoreTime(form: FormData) {
  const { userId, membership } = await currentWriter();
  const hours = Number(form.get("hours"));
  const closing = membership?.closing;
  if (!membership || !closing || ![1, 2, 3].includes(hours)) redirect("/app");
  const admin = supabaseAdmin();
  const { count } = await admin.from("requests").select("id", { count: "exact", head: true }).eq("firm_id", membership.firmId).eq("kind", "permission").eq("reason_code", "time").eq("status", "pending").eq("details->>by", userId).gt("expires_at", new Date().toISOString());
  if (!count) {
    const id = randomUUID();
    const until = laterBy(closing.close, hours * 60);
    const { data: me } = await admin.from("firm_members").select("team_id").eq("firm_id", membership.firmId).eq("user_id", userId).single();
    await admin.from("requests").insert({ id, firm_id: membership.firmId, kind: "permission", entity_type: "permission", entity_id: id, reason_code: "time", expires_at: new Date(Date.now() + 4 * 3_600_000).toISOString(), details: { by: userId, route: "owner", team_id: me?.team_id ?? null, day: closing.day, until } });
    await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "permission.asked", entity_type: "request", entity_id: id, details: { right: "time", until } });
    runJobsSoon();
  }
  redirect("/app?asked=time");
}

// Settings → Special hours: a date range with its own times (a tax season, a late evening).
export async function changeSpecialHours(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  if (!membership || !firmAdmin(membership.role, userId, membership.settings)) redirect("/app");
  const [from, to, open, close] = ["from", "to", "open", "close"].map((name) => String(form.get(name) ?? ""));
  const branch = await hoursBranch(form, supabase, membership.firmId, membership.settings, userId);
  const current = ((branch?.settings ?? membership.settings).special_hours as SpecialHours[] | undefined) ?? [];
  let special: SpecialHours[];
  if (form.get("intent") === "remove") special = current.filter((range) => range.from !== from || range.to !== to);
  else {
    const day = /^\d{4}-\d\d-\d\d$/;
    const time = /^\d\d:\d\d$/;
    if (!day.test(from) || !day.test(to) || from > to || !time.test(open) || !time.test(close) || open >= close)
      redirect(`${branch?.back ?? "/app/settings?group=hours"}&error=special`);
    special = [...current, { from, to, open, close }].sort((a, b) => a.from.localeCompare(b.from));
  }
  if (branch) await branch.save({ special_hours: special });
  else await supabase.from("firms").update({ settings: { ...membership.settings, special_hours: special } }).eq("id", membership.firmId);
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
  const { supabase, membership } = await currentWriter();
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
  const { supabase, membership } = await currentWriter();
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
  const { supabase, membership } = await currentWriter();
  const id = String(form.get("client") ?? "");
  const tab = String(form.get("tab") ?? "").replace(/[^a-z]/g, "");
  const back = (error?: string) => {
    // Assign to me on Today goes back to Today.
    if (form.get("from") === "today") return redirect(error ? "/app?error=assign" : "/app?assigned=1");
    // The details panel closes once its change is saved; other panels stay open for the next one.
    const query = new URLSearchParams({ ...(tab && tab !== "overview" && (error || tab !== "details") && { tab }), ...(error ? { error } : { changed: String(form.get("intent") ?? "") }) }).toString();
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
      can_receive_documents: form.get("can_receive_documents") === "on",
    });
    if (error) back(error.code === "23505" ? "linked" : "contact");
  } else if (intent === "contact-rights") {
    await supabase
      .from("contact_clients")
      .update({ can_receive_documents: form.get("can_receive_documents") === "on" })
      .eq("client_id", id)
      .eq("contact_id", String(form.get("contact") ?? ""));
  } else if (intent === "unlink-contact") {
    await supabase.from("contact_clients").delete().eq("client_id", id).eq("contact_id", String(form.get("contact") ?? ""));
  } else if (intent === "services") {
    // One Save for every number in the panel: each number's ticks are named after it.
    for (const registration of form.getAll("registration").map(String)) {
      const services = form.getAll(`service-${registration}`).map(String);
      const { error } = await supabase.from("client_registrations").update({ services }).eq("id", registration).eq("client_id", id);
      if (error) back("services");
    }
  } else if (intent === "remove-number") {
    // Row level security keeps a number with filed returns, which would go with it.
    const { data: removed } = await supabase.from("client_registrations").delete().eq("id", String(form.get("registration") ?? "")).eq("client_id", id).select("id");
    if (!removed?.length) back("filed-number");
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
// Settings → Reminders: whether InboxCA emails clients before their returns are due. Off
// until the owner turns it on, since it writes to the firm's clients.
export async function saveReminders(form: FormData) {
  const { supabase, membership } = await currentWriter();
  if (membership?.role !== "owner") redirect("/app");
  // Days before the due date to ask for papers, by how often the return comes; 0 is Off.
  const ask_days = Object.fromEntries(Object.entries(ASK_DAYS).map(([often, usual]) => {
    const days = Number(form.get(`ask_${often}`) ?? usual);
    return [often, askChoices.includes(days) ? days : usual];
  }));
  await supabase.from("firms").update({ settings: { ...membership.settings, reminders: form.get("on") === "on", acknowledge: form.get("acknowledge") === "on", reminder_stages: STAGES.filter((day) => form.getAll("stage").includes(String(day))), ask_days } }).eq("id", membership.firmId);
  redirect("/app/settings?group=reminders&saved=reminders#reminders");
}

// A client's page → Details: pause or resume reminders for this client.
export async function pauseReminders(form: FormData) {
  const { supabase } = await currentWriter();
  const client = String(form.get("client") ?? "");
  await supabase.from("clients").update({ reminders_paused: form.get("paused") === "on" }).eq("id", client);
  revalidatePath(`/app/clients/${client}`);
  redirect(`/app/clients/${client}?tab=details&changed=reminders`);
}

export async function saveVisibility(form: FormData) {
  const { supabase, membership } = await currentWriter();
  if (membership?.role !== "owner") redirect("/app");
  const client_visibility = form.get("visibility") === "restricted" ? "restricted" : "open";
  await supabase.from("firms").update({ settings: { ...membership.settings, client_visibility } }).eq("id", membership.firmId);
  redirect("/app/settings?group=people&saved=visibility");
}

// Calendar: mark the chosen returns in progress, filed (with each one's acknowledgement
// number), or not filed after a mistake. Row level security limits it to clients the
// person may see; every change is logged.
// A button with its own form action loses its name and value in React, so the bulk buttons
// that need a different intent call these instead of passing intent as the button's name.
export async function markTasksInProgress(form: FormData) {
  form.set("intent", "in_progress");
  return manageTasks(form);
}
export async function reopenTasks(form: FormData) {
  form.set("intent", "reopen");
  return manageTasks(form);
}

export async function manageTasks(form: FormData) {
  const { supabase, membership, userId } = await currentWriter();
  if (!membership) redirect("/app");
  const intent = form.get("intent");
  const ids = [...new Set(form.getAll("task").map(String))];
  // The day it was filed, if typed: never ahead of today.
  const typed = String(form.get("filed_on") ?? "");
  const filedOn = /^\d{4}-\d{2}-\d{2}$/.test(typed) && !Number.isNaN(Date.parse(typed)) && typed <= todayInIndia() ? typed : todayInIndia();
  if(!ids.length || ids.length>100 || ids.some(id=>!z.uuid().safeParse(id).success)) redirect("/app/calendar");
  if(intent==="filed") {
    const {data:tasks}=await supabase.from("tasks").select("id,client_id").eq("firm_id",membership.firmId).in("id",ids);
    if(tasks?.length!==ids.length || tasks.some(task=>!membership.may("mark_filed",task.client_id))) redirect("/app/calendar?error=filing");
  }
  await Promise.all(
    ids.map((id) => {
      const ack = String(form.get(`ack-${id}`) ?? "").trim().slice(0, 40);
      const change =
        intent === "filed"
          ? { status: "filed", details: { filed_on: filedOn, by: userId, ...(ack && { ack }) } }
          : intent === "in_progress"
            ? { status: "in_progress" }
            : { status: "upcoming", details: {} };
      return supabase.from("tasks").update(change).eq("id", id);
    }),
  );
  revalidatePath("/app", "layout");
  // From the Calendar: back to the same view, with a note of what changed and an Undo.
  if (form.has("view")) redirect(calendarBack(form, ["saved", String(intent)], ["t", ids.join(".")]));
  // From Today's late returns: back to Today, the same way.
  if (form.get("from") === "today") redirect(`/app?marked=${intent}&t=${ids.join(".")}`);
  // From a client's Returns tab: back to it, the same way.
  const client = String(form.get("client") ?? "");
  if (z.uuid().safeParse(client).success) {
    const back = new URLSearchParams([["tab", "returns"], ...["show", "page"].map((key) => [key, String(form.get(key) ?? "")]), ["marked", String(intent)], ["t", ids.join(".")]].filter(([, value]) => value));
    redirect(`/app/clients/${client}?${back}`);
  }
}

// The Calendar view a form came from (its view, day, return, page and month), with a note.
const calendarBack = (form: FormData, ...notes: [string, string][]) =>
  `/app/calendar?${new URLSearchParams([...["view", "day", "code", "page", "month"].map((key) => [key, String(form.get(key) ?? "")]), ...notes].filter(([, value]) => value))}`;

// Where Send reminder now came from, to go back to: a paper item's page, the client's Returns
// tab, or the Calendar view.
const remindBack = (form: FormData, ...notes: [string, string][]) => {
  const [from, client, request] = ["from", "client", "request"].map((key) => String(form.get(key) ?? ""));
  if (from === "papers" && z.uuid().safeParse(request).success) return `/app/papers/${request}?${new URLSearchParams(notes)}`;
  if (from === "client" && z.uuid().safeParse(client).success) return `/app/clients/${client}?${new URLSearchParams([["tab", "returns"], ...notes])}`;
  return calendarBack(form, ...notes);
};

// Send reminder now: the Calendar's Remind client (after its preview), the client's Returns tab
// and a paper item. The reminder job emails the client once, from the firm's mailbox, about its
// returns late or due within 7 days and the papers still missing, the same email as the daily
// reminders; it waits 20 seconds so Undo can stop it. For those who manage clients and those who
// look after this client; never a second email to the client in a day.
export async function remindClient(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  if (!membership) redirect("/app");
  const { data: client } = await supabase.from("clients").select("id").eq("firm_id", membership.firmId).eq("id", String(form.get("client") ?? "")).is("archived_at", null).maybeSingle();
  if (!client || !(canManageClients(membership.role) || (await supabase.rpc("looks_after", { target_firm: membership.firmId, client: client.id })).data)) redirect(remindBack(form));
  const admin = supabaseAdmin();
  const { count: sent } = await admin.from("activity_log").select("at", { count: "exact", head: true }).eq("firm_id", membership.firmId).eq("entity_id", client.id).eq("action", "reminder.sent").gte("at", `${todayInIndia()}T00:00:00+05:30`);
  if (sent) redirect(remindBack(form, ["error", "reminded"]));
  const { data: job, error } = await admin.from("jobs").insert({ firm_id: membership.firmId, kind: "reminders", entity_type: "client", entity_id: client.id, idempotency_key: `reminders:client:${client.id}:${randomUUID()}`, run_at: new Date(Date.now() + 20_000).toISOString() }).select("id").single();
  if (error) redirect(remindBack(form, ["error", "send"]));
  await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "reminders.asked", entity_type: "client", entity_id: client.id, details: { what: "soon" } });
  redirect(remindBack(form, ["reminding", client.id], ["job", String(job.id)]));
}

// A paper item: the person asked the client for the missing papers by phone. It counts as an
// ask, so the next follow up waits 3 days, and the item leaves until one more goes unanswered.
export async function askedByPhone(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  if (!membership) redirect("/app");
  const { data: request } = await supabase.from("requests").select("id, client_id, details").eq("firm_id", membership.firmId).eq("kind", "documents").eq("status", "pending").eq("id", String(form.get("request") ?? "")).maybeSingle();
  if (!request?.client_id || !(canManageClients(membership.role) || (await supabase.rpc("looks_after", { target_firm: membership.firmId, client: request.client_id })).data)) redirect("/app");
  const admin = supabaseAdmin();
  await admin.from("requests").update({ details: { ...(request.details as Record<string, unknown>), chased: todayInIndia() } as unknown as NonNullable<Json> }).eq("id", request.id);
  await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "request.phoned", entity_type: "request", entity_id: request.id });
  revalidatePath("/app", "layout");
  redirect(`/app/papers/${request.id}?phoned=1`);
}

// A paper item: every paper is in; opening the figures to check them takes it off the list.
export async function checkFigures(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  if (!membership) redirect("/app");
  const { data: item } = await supabase.from("requests").select("id, client_id").eq("firm_id", membership.firmId).eq("kind", "alert").eq("entity_type", "papers_in").eq("entity_id", String(form.get("request") ?? "")).maybeSingle();
  if (!item?.client_id || !(canManageClients(membership.role) || (await supabase.rpc("looks_after", { target_firm: membership.firmId, client: item.client_id })).data)) redirect("/app");
  const { data: seen } = await supabaseAdmin().from("requests").update({ status: "done" }).eq("id", item.id).eq("status", "pending").select("id").maybeSingle();
  if (seen) await supabaseAdmin().from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "request.changed", entity_type: "request", entity_id: item.id });
  revalidatePath("/app", "layout");
  redirect(`/app/clients/${item.client_id}?tab=extraction`);
}

export type MailboxState = { error?: string; values?: Record<string, string> };
const mailboxErrors = {
  invalid: "Enter the firm's email address and its password.",
  microsoft: "This address is on Outlook or Microsoft 365, which connects only with Microsoft sign in. InboxCA cannot use Microsoft sign in yet, so this address cannot be connected for now.",
  sign_in: "InboxCA could not sign in with that address and password.",
  server: "InboxCA could not reach the mail server. Check the server settings above.",
};
const microsoftLine = () => (mailSignInReady("outlook") ? "This address is on Outlook or Microsoft 365. Use Connect with Microsoft above." : mailboxErrors.microsoft);

// Settings → Firm email: the owner connects the firm's mailbox. Both sign ins are checked
// first; the address and password are saved encrypted with the firm's key.
export async function connectMailbox(_prev: MailboxState, form: FormData): Promise<MailboxState> {
  const { membership, userId } = await currentWriter();
  if (membership?.role !== "owner") redirect("/app");
  const values = Object.fromEntries(["address", "imap_host", "imap_port", "smtp_host", "smtp_port"].map((key) => [key, String(form.get(key) ?? "").trim()]));
  const address = values.address.toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!z.email().safeParse(address).success || !password) return { error: mailboxErrors.invalid, values };
  const typed = values.imap_host && values.smtp_host;
  const settings = typed
    ? { imap: { host: values.imap_host, port: Number(values.imap_port) || 993 }, smtp: { host: values.smtp_host, port: Number(values.smtp_port) || 465 } }
    : await detectSettings(address);
  if (settings === "microsoft") return { error: microsoftLine(), values };
  const checked = await checkMailbox(address, password, settings);
  if ("error" in checked) return { error: checked.error === "sign_in" ? `${mailboxErrors.sign_in} ${providerFor(settings.imap.host)?.help ?? "Check the password, or use an app password."}` : mailboxErrors.server, values: { ...values, ...serverValues(settings) } };

  const admin=supabaseAdmin();
  const {data:prior,error:readError}=await admin.from("connected_accounts").select("id,status,address_enc,address_bidx,sync_cursor,settings").eq("firm_id",membership.firmId).eq("kind","mail").maybeSingle();
  if (readError) return {error:"The email connection could not be read. Try again.",values};
  const crypto=serverCrypto();
  const index=await crypto.blindIndex(membership.firmId,"email",address);
  const priorIndex=prior && (prior.address_bidx ?? await crypto.blindIndex(membership.firmId,"email",await crypto.decrypt(membership.firmId,`accounts/${prior.id}/address`,prior.address_enc)));
  if (prior && (prior.status!=="needs_reconnect" || priorIndex!==index)) return {error:"A mailbox is already connected. Disconnect it first to use another address.",values};
  const id=prior?.id ?? randomUUID();
  const fields={
    id,firm_id:membership.firmId,kind:"mail",provider:"imap",status:"connected",
    address_enc:await crypto.encrypt(membership.firmId,`accounts/${id}/address`,address),address_bidx:index,
    credentials_enc:await crypto.encrypt(membership.firmId,`accounts/${id}/credentials`,JSON.stringify({password})),
    sync_cursor:prior?.sync_cursor ?? checked.cursor,
    settings:{...(prior?.settings as Record<string,Json> ?? {}),imap:settings.imap,smtp:settings.smtp,mail_failures:{read:0,send:0}},
  };
  const {error}=prior ? await admin.from("connected_accounts").update(fields).eq("id",id) : await admin.from("connected_accounts").insert(fields);
  if (error) return {error:"The email connection could not be saved. Try again.",values};
  await admin.from("activity_log").insert({firm_id:membership.firmId,actor_id:userId,action:prior ? "mailbox.reconnected" : "mailbox.connected",entity_type:"account",entity_id:id});
  if (prior) await admin.from("jobs").update({run_at:new Date().toISOString()}).eq("firm_id",membership.firmId).eq("state","pending").in("kind",["reminders","bulk_send","records_reply","file_mail","notice_from_mail"]);
  await admin.from("jobs").insert({firm_id:membership.firmId,kind:"mail_poll",entity_type:"account",entity_id:id,idempotency_key:`mail_poll:${id}:${randomUUID()}`});
  runJobsSoon();
  revalidatePath("/app/settings");
  return {};
}
// What InboxCA finds for an address, in plain words, shown as the owner types it.
export async function findMailServer(address: string) {
  const { membership } = await currentMember();
  if (membership?.role !== "owner" || !z.email().safeParse(address.trim()).success) return "";
  const found = await detectSettings(address.trim().toLowerCase());
  if (found === "microsoft") return microsoftLine();
  const help = providerFor(found.imap.host)?.help;
  return found.name ? `Found ${found.name}.${help ? ` ${help}` : ""}` : "InboxCA did not find this provider, so it will try the usual server names.";
}
const serverValues = ({ imap, smtp }: { imap: { host: string; port: number }; smtp: { host: string; port: number } }) => ({
  imap_host: imap.host,
  imap_port: String(imap.port),
  smtp_host: smtp.host,
  smtp_port: String(smtp.port),
});

// Settings → Firm email: Connect with Google, Microsoft or Zoho, shown only once its app's
// keys are set. The owner signs in on the provider's own page and /api/oauth/<provider>/
// callback finishes; the PKCE verifier and state wait in a short cookie for it. A firm on
// Microsoft 365 whose admin must allow apps asks the admin to allow InboxCA once first.
export async function connectMailSignIn(form: FormData) {
  const { membership } = await currentWriter();
  if (membership?.role !== "owner") redirect("/app");
  const provider = String(form.get("provider") ?? "");
  if (!isMailApi(provider) || !mailSignInReady(provider)) redirect("/app/settings?group=email&error=mail_failed#mailbox");
  const { verifier, challenge } = pkce();
  const state = randomUUID();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  (await cookies()).set(MAIL_COOKIE, Buffer.from(JSON.stringify({ state, verifier, provider })).toString("base64url"), {
    httpOnly: true,
    secure: origin.startsWith("https"),
    sameSite: "lax",
    maxAge: 600,
    path: "/api/oauth",
  });
  const back = `${origin}/api/oauth/${provider}/callback`;
  redirect(provider === "outlook" && form.get("admin") === "1" ? adminConsent(state, back) : mailSignIn(provider, state, challenge, back));
}

// Disconnecting deletes the saved password or token at once, so nothing more is read or
// sent; a sign in token is first taken back at its provider where the provider allows it.
export async function disconnectMailbox() {
  const { supabase, membership, userId } = await currentWriter();
  if (membership?.role !== "owner") redirect("/app");
  await forgetMailToken(membership.firmId, userId).catch(() => log.warn("mail_token_not_revoked", {}));
  await supabase.from("connected_accounts").delete().eq("firm_id", membership.firmId).eq("kind", "mail");
  revalidatePath("/app/settings");
}

// Inbox: correct an email's label (a person's choice wins over the rules and is logged),
// take an email out of Needs reply when it needs none (and undo that from the toast), snooze
// it, give it to a teammate, or file mail InboxCA could not match to a client.
export async function manageEmail(form: FormData) {
  const { supabase, membership } = await currentWriter();
  if (!membership) redirect("/app");
  const label = String(form.get("label") ?? "");
  const request = String(form.get("request") ?? "");
  const back = String(form.get("back") ?? "");
  if (form.get("intent") === "label" && label in labels)
    await supabase.from("email_events").update({ label, decision_source: "staff" }).eq("id", String(form.get("email") ?? ""));
  else if (form.get("intent") === "done" || form.get("intent") === "undo") {
    // One email, or every email of a list at once (Mark all as done), and Undo for either.
    const undo = form.get("intent") === "undo";
    const requests = form.getAll("request").map(String).slice(0, 100);
    await supabase.from("requests").update({ status: undo ? "pending" : "done" }).in("id", requests).eq("kind", "team_reply").eq("status", undo ? "done" : "pending");
    if (back.startsWith("/app/inbox")) {
      revalidatePath("/app", "layout");
      redirect(undo ? back : `${back}${back.includes("?") ? "&" : "?"}cleared=${requests.join(".")}`);
    }
  } else if (["snooze", "wake", "assign"].includes(String(form.get("intent")))) {
    // Snooze until a day, and who answers, live in the request's details. The person's own
    // reading of the request decides (row level security); the server then writes them.
    const intent = form.get("intent");
    const today = todayInIndia();
    const until = String(form.get("until") ?? "");
    const who = String(form.get("who") ?? "");
    const { data: ask } = await supabase.from("requests").select("id, details").eq("id", request).eq("kind", "team_reply").eq("status", "pending").maybeSingle();
    const { data: person } = intent === "assign" && who ? await supabaseAdmin().from("firm_members").select("user_id").eq("firm_id", membership.firmId).eq("user_id", who).eq("status", "active").maybeSingle() : { data: null };
    const fine = intent === "snooze" ? /^\d{4}-\d{2}-\d{2}$/.test(until) && until > today && until <= addDays(today, 366) : intent === "wake" || !who || !!person;
    if (ask && fine) {
      const details = { ...(ask.details as Record<string, Json>) };
      if (intent === "snooze") details.snooze = until;
      else if (intent === "wake") delete details.snooze;
      else if (who) details.assignee = who;
      else delete details.assignee;
      await supabaseAdmin().from("requests").update({ details }).eq("id", ask.id);
      if (back.startsWith("/app/inbox")) {
        revalidatePath("/app", "layout");
        redirect(intent === "wake" ? back : `${back}${back.includes("?") ? "&" : "?"}${intent === "snooze" ? "snoozed" : "assigned"}=${ask.id}`);
      }
    }
  } else if (form.get("intent") === "client" || form.get("intent") === "file") {
    // Mail from a contact who writes for several clients: a person says which client it is
    // for, among the contact's own clients they may see; its attachments are then filed.
    // File to a client: mail InboxCA could not match goes to any client the person may see.
    const filing = form.get("intent") === "file";
    const email = String(form.get("email") ?? "");
    const { data: client } = await supabase.from("clients").select("id").eq("firm_id",membership.firmId).eq("id", String(form.get("client") ?? "")).maybeSingle();
    const admin = supabaseAdmin();
    const { data: event } = await admin.from("email_events").select("id, contact_id, label").eq("id", email).eq("firm_id", membership.firmId).is("client_id", null).maybeSingle();
    const { data: link } = filing ? { data: client && { client_id: client.id } } : await admin.from("contact_clients").select("client_id").eq("contact_id", event?.contact_id ?? "").eq("client_id", client?.id ?? "").maybeSingle();
    if (event && link) {
      await admin.from("email_events").update({ client_id: link.client_id }).eq("id", event.id);
      await admin.from("requests").update({ status: "done" }).eq("kind", "team_reply").eq("entity_id", event.id);
      const kind = event.label === "notice_received" ? "notice_from_mail" : "file_mail";
      await admin.from("jobs").upsert({ firm_id: membership.firmId, kind, entity_type: "email", entity_id: event.id, idempotency_key: `${kind}:${event.id}` }, { onConflict: "idempotency_key", ignoreDuplicates: true });
      if (filing && back.startsWith("/app/inbox")) {
        revalidatePath("/app", "layout");
        redirect(`${back}${back.includes("?") ? "&" : "?"}filed=1`);
      }
    }
  }
  // The sidebar's Inbox count is in the layout.
  revalidatePath("/app", "layout");
}

// Settings → Firm drive: the owner connects the firm's drive after ticking the Drive
// access terms. Dropbox signs in on its own page (the callback finishes in
// /api/drive/callback); the test drive exists only where the server has one.
export async function connectDrive(form: FormData) {
  const { supabase, membership } = await currentWriter();
  if (membership?.role !== "owner") redirect("/app");
  const provider = String(form.get("provider") ?? "");
  if (form.get("agree") !== "on") redirect("/app/settings?group=email&error=drive_terms#drive");
  if (provider === "dropbox" && process.env.DROPBOX_APP_KEY) await dropboxStart();
  if (provider !== "local" || !process.env.DRIVE_LOCAL_DIR) redirect("/app/settings?group=email&error=drive_provider#drive");
  const { error } = await saveDrive(supabase, membership.firmId, "local", "Test drive on this computer", "{}");
  if (error) redirect(`/app/settings?group=email&error=${error}#drive`);
  runJobsSoon();
  revalidatePath("/app/settings");
}

// Dropbox's own sign in page; a reconnect names the drive it signs in to again.
async function dropboxStart(account?: string) {
  const { verifier, challenge } = pkce();
  const state = randomUUID();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  (await cookies()).set(DRIVE_COOKIE, Buffer.from(JSON.stringify({ state, verifier, account })).toString("base64url"), {
    httpOnly: true,
    secure: origin.startsWith("https"),
    sameSite: "lax",
    maxAge: 600,
    path: "/api/drive",
  });
  redirect(dropboxSignIn(state, challenge, `${origin}/api/drive/callback`));
}

// Reconnect, beside the connected drive: the owner signs in to the same drive again, losing
// nothing (renewDrive). The test drive has no sign in, so it is only checked again.
export async function reconnectDrive() {
  const { supabase, userId, membership } = await currentWriter();
  if (membership?.role !== "owner") redirect("/app");
  const { data: drive } = await supabase.from("connected_accounts").select("id, provider").eq("firm_id", membership.firmId).eq("kind", "drive").maybeSingle();
  if (drive?.provider === "dropbox" && process.env.DROPBOX_APP_KEY) await dropboxStart(drive.id);
  if (drive?.provider !== "local" || !process.env.DRIVE_LOCAL_DIR) redirect("/app/settings?group=email&error=drive_provider#drive");
  const { error } = await renewDrive(membership.firmId, drive.id, userId);
  if (error) redirect(`/app/settings?group=email&error=${error}#drive`);
  runJobsSoon();
  revalidatePath("/app", "layout");
  redirect("/app/settings?group=email&saved=drive#drive");
}

// Disconnecting deletes InboxCA's access at once; the files stay in the firm's drive.
export async function disconnectDrive() {
  const { supabase, membership } = await currentWriter();
  if (membership?.role !== "owner") redirect("/app");
  await supabase.from("connected_accounts").delete().eq("firm_id", membership.firmId).eq("kind", "drive");
  revalidatePath("/app/settings");
}

// Closing the firm (PLAN.md 5.5.1): the owner types the firm's name, which the database
// checks again. Its data is deleted 30 days later and its log a year after that.
export async function closeFirm(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  if (membership?.role !== "owner") redirect("/app");
  // Closing deletes the firm's connections, so a mailbox sign in is read first and taken back
  // at Google or Zoho once the firm is closed.
  const forget = await mailTokenForget(membership.firmId, userId).catch(() => null);
  const { data } = await supabase.rpc("close_firm", { target_firm: membership.firmId, typed_name: String(form.get("name") ?? "") });
  if (data) await forget?.().catch(() => log.warn("mail_token_not_revoked", {}));
  // The notice before deletion, by Orelu's system email once it is set up.
  if (data) await sendSystemMail(membership.email, `${membership.firmName} is closed on InboxCA`, [
    `You closed ${membership.firmName} on InboxCA. Your team can no longer sign in.`,
    `On ${dueLabel(addDays(todayInIndia(), 30))} InboxCA deletes your firm's data. Until then you can sign in and download it from Settings, Your data.`,
    "Files in your own drive are not touched.",
  ].join("\n\n")).catch(() => log.warn("close.system_mail_failed"));
  redirect(data ? "/app/settings" : "/app/settings?group=data&error=close_name#close");
}

// Orelu support access (PLAN.md 8.5): the owner allows an hour's look, refuses, or ends it early.
export async function answerSupport(form: FormData) {
  const { supabase, membership } = await currentWriter();
  if (membership?.role !== "owner") redirect("/app");
  const decision = String(form.get("decision"));
  if (["approve", "refuse", "end"].includes(decision)) await supabase.rpc("answer_support", { target: membership.firmId, decision });
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

// Files whose words include every word typed, among the clients the person may see; one
// client's files when a client is given. Words are matched by their keyed tokens.
export async function findDocuments(text: string, client?: string) {
  const { supabase, membership } = await currentMember();
  const typed = words(text.slice(0, 200), 8);
  if (!membership || !typed.length) return [];
  let query = supabase
    .from("documents")
    .select("id, client_id, name, clients(name)")
    .contains("search_tokens", await searchTokens(membership.firmId, typed))
    .neq("status", "deleted")
    .order("received_at", { ascending: false })
    .limit(client ? 200 : 8);
  if (client) query = query.eq("client_id", client);
  return (await query).data ?? [];
}

// The type, work and period a person chose for a file, or null when they do not fit. An
// upload of several files sends one set a file, in the files' order.
function documentValues(form: FormData, at = 0) {
  const field = (name: string) => String(form.getAll(name)[at] ?? "");
  const type = field("type") === "Other" ? field("custom").trim() : field("type");
  const work = field("work");
  const period = field("period") === "none" ? "" : field("period");
  if (!type || type.length > 80 || !(work in workTypes) || (period && !periodChoices(todayInIndia()).includes(period))) return null;
  return { work_type: work as WorkType, document_type: type, period_key: period };
}

// Other names the owner, a partner or a manager adds to the firm's own types, which everyone
// then chooses from like the usual ones (PLAN.md 5.3, 5.17.2). types are in the files' order.
async function keepFirmTypes(form: FormData, membership: { firmId: string; role: string; settings: Record<string, unknown> }, types: string[]) {
  const kept = (membership.settings.document_types ?? []) as string[];
  const added = [...new Set(types.filter((type, at) => form.getAll("type")[at] === "Other" && form.getAll("keep").includes(String(at)) && !documentTypes.includes(type) && !kept.includes(type)))];
  if (!added.length || !canManageClients(membership.role) || kept.length + added.length > 100) return;
  await supabaseAdmin().from("firms").update({ settings: { ...membership.settings, document_types: [...kept, ...added] } }).eq("id", membership.firmId);
}

// The firm's drive and its folder order, or null when no drive is connected.
async function firmDrive(firmId: string) {
  const { data: account } = await supabaseAdmin().from("connected_accounts").select("id, provider, credentials_enc, settings").eq("firm_id", firmId).eq("kind", "drive").maybeSingle();
  if (!account) return null;
  const settings = account.settings as { folder_order?: FolderOrder; naming?: Naming };
  return { drive: await openDrive(firmId, account), order: settings.folder_order ?? "year_client_work", naming: settings.naming };
}

// A document the person may see, with what moving it needs; the server reads where it is.
async function visibleDocument(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  const id = String(form.get("document") ?? "");
  if(!membership) redirect("/app");
  const { data: visible } = await supabase.from("documents").select("id, client_id").eq("firm_id",membership.firmId).eq("id", id).maybeSingle();
  if (!membership || !visible) redirect("/app");
  const back = `/app/clients/${visible.client_id}?tab=files`;
  const [{ data: document }, opened] = await Promise.all([
    supabaseAdmin().from("documents").select("work_type, document_type, share_policy, period_key, status, name, drive_file_id, received_at, registration_id, clients(name)").eq("firm_id",membership.firmId).eq("id", id).single(),
    firmDrive(membership.firmId),
  ]);
  if (!document?.clients || !opened) redirect(`${back}&error=drive`);
  return { id, userId, membership, back, document, client: document.clients.name, clientId: visible.client_id, ...opened };
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
  const { id, userId, membership, back, document, client, clientId, drive, order, naming } = await visibleDocument(form);
  if(!membership.may("rename",clientId)) redirect(`${back}&error=needs`);
  const {data:prepared}=await supabaseAdmin().from("documents").select("prepared").eq("firm_id",membership.firmId).eq("id",id).single();
  if(prepared?.prepared || document.status === "deleted") redirect(back);
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
      : await placeUnderFreeName({ client, type: next.document_type, period: periodName(next.period_key), extension: path.extname(document.name) }, receivedLabel(document.received_at), place, naming);
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
  await keepFirmTypes(form, membership, [next.document_type]);
  await tellOwnerOnRepeat(membership.firmId, userId, membership.email, "document.renamed", "renames");
  await queueRead(membership.firmId, id);
  revalidatePath("/app", "layout");
  redirect(`${back}&renamed=${id}`);
}

// Saves a file a person brought into the client's folder in the drive and records it,
// logged with who did it, and whether it was a portal file. Refuses a file the client already
// has. A GST paper gets the client's GSTIN, or the one chosen; a filed one may become the
// current version. Scanned says the file worker's virus check passed it (src/lib/intake.ts).
async function saveForClient(
  membership: { firmId: string },
  userId: string | null,
  client: { id: string; name: string },
  values: { work_type: WorkType; document_type: string; period_key: string; status: "filed" | "to_check"; registration_id?: string | null },
  file: { name: string; bytes: Uint8Array },
  opened: NonNullable<Awaited<ReturnType<typeof firmDrive>>>,
  scanned: boolean,
  portal = false,
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
    opened.naming,
  );
  if (placed === "taken") return "drive" as const;
  const id = randomUUID();
  const { data: gstins } = values.work_type === "gst" ? await admin.from("client_registrations").select("id").eq("client_id", client.id).eq("kind", "gstin") : { data: [] };
  const registration_id = gstinFor(values.work_type, (gstins ?? []).map((row) => row.id), values.registration_id);
  await admin.from("documents").insert({
    id,
    firm_id: membership.firmId,
    client_id: client.id,
    ...values,
    registration_id,
    drive_file_id: placed.id,
    name: placed.name,
    original_name_enc: await serverCrypto().encrypt(membership.firmId, `documents/${id}/original_name`, file.name),
    size: file.bytes.length,
    sha256,
    received_at: now,
    scanned_at: scanned ? now : null,
  });
  await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "document.uploaded", entity_type: "document", entity_id: id, ...(portal && { details: { from: "portal" } }) });
  if (values.status === "filed") await settleVersions(admin, { client_id: client.id, ...values, registration_id });
  await queueRead(membership.firmId, id);
  return { id };
}

const MAX_UPLOAD = 50 * 1024 * 1024;
// The summary's last two counts, when there are any: files the checks stopped, and files
// that could not be checked just now (DroppedNotice).
const notSaved = (count: { unsafe: number; unchecked: number }) => (count.unsafe || count.unchecked ? `-${count.unsafe}-${count.unchecked}` : "");

// Files the owner, a partner or a manager uploads for a client, one or several at once, each
// typed by them, saved into the client's folder in the drive like a file from mail (PLAN.md
// 5.3). Up to 50 MB together, each checked by the file worker first; each file in a ZIP is
// saved with the ZIP's type, work and period. A file the client already has is refused, or
// left out of several.
export async function uploadDocument(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  if(!membership) redirect("/app");
  const { data: client } = await supabase.from("clients").select("id, name").eq("firm_id",membership.firmId).eq("id", String(form.get("client") ?? "")).maybeSingle();
  if (!membership || !client) redirect("/app");
  const back = `/app/clients/${client.id}?tab=files`;
  // Uploading is a request unless the owner switched it on for this role (5.17.2).
  const grant = membership.may("upload", client.id) ? null : await grantFor(membership.firmId, userId, "upload", client.id);
  if (!membership.may("upload", client.id) && !grant) redirect(`${back}&error=needs`);
  const files = form.getAll("file").filter((file): file is File => file instanceof File && file.size > 0);
  const values = files.map((_, at) => documentValues(form, at)).filter((value) => !!value);
  if (!files.length || files.length > 20 || values.length !== files.length || files.reduce((sum, file) => sum + file.size, 0) > MAX_UPLOAD) redirect(`${back}&upload=1&error=upload`);
  // GST papers of a client with more than one GSTIN name their GSTIN.
  const registration = String(form.get("registration") ?? "");
  const { data: gstins } = values.some((value) => value.work_type === "gst") ? await supabase.from("client_registrations").select("id").eq("firm_id", membership.firmId).eq("client_id", client.id).eq("kind", "gstin") : { data: [] };
  if ((gstins?.length ?? 0) > 1 && !gstins?.some((row) => row.id === registration)) redirect(`${back}&upload=1&error=gstin`);
  const opened = await firmDrive(membership.firmId);
  if (!opened) redirect(`${back}&error=drive`);
  const saved: string[] = [];
  const count = { twin: 0, unsafe: 0, unchecked: 0 };
  for (const [at, file] of files.entries()) {
    const sent = await receive(membership.firmId, userId, client, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, opened.drive).catch(() => null);
    if (!sent || "unsafe" in sent) {
      if (files.length === 1) redirect(`${back}&upload=1&error=${sent ? sent.unsafe : "scan"}`);
      count[sent ? "unsafe" : "unchecked"]++;
      continue;
    }
    for await (const paper of sent.papers) {
      const result = await saveForClient(membership, userId, client, { ...values[at], status: "filed", registration_id: registration }, paper, opened, sent.scanned);
      if (result === "drive") redirect(`${back}&error=drive`);
      if (result === "twin") count.twin++;
      else saved.push(result.id);
    }
  }
  if (files.length === 1 && !saved.length) redirect(`${back}&upload=1&error=${count.twin ? "twin" : "upload"}`);
  await spendGrant(grant);
  await keepFirmTypes(form, membership, values.map((value) => value.document_type));
  revalidatePath("/app", "layout");
  // One paper says where it went; several say how many were filed, there already or not saved.
  redirect(saved.length === 1 && !count.twin && !count.unsafe && !count.unchecked ? `${back}&saved=${saved[0]}` : `${back}&dropped=${saved.length}-${count.twin}-0${notSaved(count)}`);
}

// What each file's name says it is, by the rules that file attachments from mail, so the
// upload form starts from a guess the person corrects (PLAN.md 5.5.0). Nothing is kept.
export async function guessPapers(names: string[]) {
  const { membership } = await currentMember();
  if (!membership) return [];
  const today = todayInIndia();
  return names.slice(0, 20).map((name) => {
    const { type, work, period } = describeFile(String(name).slice(0, 255), "", null, today);
    return { type: type === "Document" ? "" : type, work: work === "other" ? "" : work, period: periodChoices(today).includes(period) ? period : "" };
  });
}

// Files staff fetched from the government portals, dropped in one or many at a time (PLAN.md
// 5.3.1, D39). Each is known by its own contents; the client comes from the GSTIN or PAN
// inside it and must be one the person may see. Every member may do this. A file that is not a known
// portal file is filed under the client's To check only when the owner, a partner or a
// manager drops it on that client's page; otherwise it is left out, and the summary says so.
export async function dropPortalFiles(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  if (!membership) redirect("/app");
  const onClient = String(form.get("client") ?? "");
  // Back where the box was opened: Today, Documents, or the client's Documents or Returns tab.
  const back = onClient ? `/app/clients/${onClient}?tab=${form.get("back") === "returns" ? "returns" : "files"}&` : form.get("back") === "/app/documents" ? "/app/documents?" : "/app?";
  const opened = await firmDrive(membership.firmId);
  if (!opened) redirect(`${back}error=drive`);
  const crypto = serverCrypto();
  const count = { filed: 0, again: 0, left: 0, unsafe: 0, unchecked: 0 };
  const { data: client } = onClient ? await supabase.from("clients").select("id, name").eq("firm_id",membership.firmId).eq("id", onClient).maybeSingle() : { data: null };
  for (const dropped of form.getAll("files")) {
    if (!(dropped instanceof File) || !dropped.size) continue;
    if (dropped.size > MAX_UPLOAD) {
      count.left++;
      continue;
    }
    // Checked by the file worker first; the portal's ZIP downloads give each file inside.
    const sent = await receive(membership.firmId, userId, client, { name: dropped.name, bytes: new Uint8Array(await dropped.arrayBuffer()) }, opened.drive).catch(() => null);
    if (!sent || "unsafe" in sent) {
      count[sent ? "unsafe" : "unchecked"]++;
      continue;
    }
    for await (const file of sent.papers) {
      const bytes = file.bytes;
      // A GST paper names its client by GSTIN, an income tax paper by PAN.
      const portal = recognisePortalFile(bytes) ?? await recognisePortalPdf(bytes);
      const [kind, number] = !portal ? [] : "gstin" in portal ? ["gstin", portal.gstin] : ["pan", portal.pan];
      const { data: registration } = kind && number
        ? await supabase.from("client_registrations").select("id, client_id, clients(id, name)").eq("firm_id",membership.firmId).eq("kind", kind).eq("number_bidx", await crypto.blindIndex(membership.firmId, kind, number)).maybeSingle()
        : { data: null };
      let saved: Awaited<ReturnType<typeof saveForClient>> | null = null;
      if (portal && registration?.clients && membership.may("portal_files",registration.client_id)) {
        saved = await saveForClient(membership, userId, registration.clients, { work_type: kind === "gstin" ? "gst" : "income_tax", document_type: portal.type, period_key: portal.period, status: "filed", registration_id: kind === "gstin" ? registration.id : null }, file, opened, sent.scanned, true);
        // The "still missing" item asked for by this file's name closes; a request with every item in closes, and its reminders stop.
        if (typeof saved === "object") await receiveAsked(supabaseAdmin(), registration.client_id, portal.type, portal.period, saved.id);
      } else if (!portal && client && membership.may("upload", client.id)) {
        saved = await saveForClient(membership, userId, client, { work_type: "other", document_type: "Document", period_key: "", status: "to_check" }, file, opened, sent.scanned);
      }
      if (saved === "twin") count.again++;
      else if (saved && saved !== "drive") count.filed++;
      else count.left++;
    }
  }
  revalidatePath("/app", "layout");
  redirect(`${back}dropped=${count.filed}-${count.again}-${count.left}${notSaved(count)}`);
}

// A PDF's password, typed in the viewer by a person who may see the file (PLAN.md 5.15: never
// guessed). It is kept encrypted with the firm's key so the team can open the file, logged,
// and the file is read again for search. A wrong one is simply asked for again.
export async function savePassword(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  const password = String(form.get("password") ?? "");
  if (!membership || !password || password.length > 200) return "invalid" as const;
  const { data: file } = await supabase.from("documents").select("id, name").eq("firm_id", membership.firmId).eq("id", String(form.get("document") ?? "")).neq("status", "deleted").maybeSingle();
  if (!file || !/\.pdf$/i.test(file.name)) return "invalid" as const;
  const admin = supabaseAdmin();
  await admin.from("documents").update({ password_enc: await serverCrypto().encrypt(membership.firmId, `documents/${file.id}/password`, password) }).eq("firm_id", membership.firmId).eq("id", file.id);
  await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "document.password_saved", entity_type: "document", entity_id: file.id });
  await fileUnlocked(membership, userId, file.id, password).catch(() => undefined);
  await queueRead(membership.firmId, file.id);
  return "saved" as const;
}

// A locked file a permitted person left under the client's To check is known once the
// password typed for it opens it. An income tax paper with this client's PAN is then filed
// like any portal file (PLAN.md 5.3.1), as that person's rename; anything else stays.
async function fileUnlocked(membership: NonNullable<Awaited<ReturnType<typeof currentWriter>>["membership"]>, userId: string, id: string, password: string) {
  const admin = supabaseAdmin();
  const { data: paper } = await admin.from("documents").select("client_id, status, name, drive_file_id, received_at, clients(name)").eq("firm_id", membership.firmId).eq("id", id).single();
  const opened = paper?.clients && paper.status === "to_check" && membership.may("portal_files", paper.client_id) ? await firmDrive(membership.firmId) : null;
  if (!paper?.clients || !opened) return;
  const portal = await recognisePortalPdf(await opened.drive.read(paper.drive_file_id), password);
  const { data: own } = portal ? await admin.from("client_registrations").select("id").eq("firm_id", membership.firmId).eq("client_id", paper.client_id).eq("kind", "pan").eq("number_bidx", await serverCrypto().blindIndex(membership.firmId, "pan", portal.pan)).maybeSingle() : { data: null };
  if (!portal || !own) return;
  const client = paper.clients.name, folder = await opened.drive.ensureFolder(folderFor(opened.order, client, { work: "income_tax", period: portal.period, receivedAt: paper.received_at, toCheck: false }));
  const placed = await placeUnderFreeName({ client, type: portal.type, period: periodName(portal.period), extension: path.extname(paper.name) }, receivedLabel(paper.received_at), (name) => opened.drive.move(paper.drive_file_id, folder, name), opened.naming);
  if (placed === "taken") return;
  await admin.rpc("rename_document", { target: id, actor: userId, new_work: "income_tax", new_type: portal.type, new_period: portal.period, new_status: "filed", new_name: placed.name, new_file: placed.id });
  await settleVersions(admin, { client_id: paper.client_id, work_type: "income_tax", document_type: portal.type, period_key: portal.period, registration_id: null });
  await receiveAsked(admin, paper.client_id, portal.type, portal.period, id);
}

// The owner has seen that the virus check stopped a file (src/lib/intake.ts); it leaves Today.
// People change only team replies through their own access, so the server closes the alert
// after checking that this is the firm's owner, and logs who did.
export async function seenAlert(form: FormData) {
  const { userId, membership } = await currentWriter();
  if (membership?.role !== "owner") redirect("/app");
  const { data: seen } = await supabaseAdmin().from("requests").update({ status: "done" }).eq("firm_id", membership.firmId).eq("kind", "alert").eq("entity_type", "virus").eq("status", "pending").eq("id", String(form.get("alert") ?? "")).select("id").maybeSingle();
  if (seen) await supabaseAdmin().from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "request.changed", entity_type: "request", entity_id: seen.id });
  revalidatePath("/app", "layout");
  redirect("/app");
}

// The owner removes a file, or puts back one removed in the last 30 days (D18). A removed
// file moves to the drive's Removed papers folder; the nightly purge sends it to
// the drive's bin after 30 days. Removing for staff and managers is a request (later).
export async function removeDocument(form: FormData) {
  const { id, userId, membership, back, document, client, clientId, drive, order, naming } = await visibleDocument(form);
  const restoring = form.get("intent") === "restore";
  // Removing is the owner's, or once with the owner's or a deputy's grant; putting back is the owner's.
  const grant = membership.role === "owner" || restoring ? null : await grantFor(membership.firmId, userId, "remove", clientId, id);
  if (membership.role !== "owner" && !grant) redirect(`${back}&error=owner`);
  if (restoring !== (document.status === "deleted")) redirect(back);
  const from = restoring ? await placeBefore(membership.firmId, id, "document.removed") : undefined;
  const status = restoring ? (from?.status ?? "filed") : "deleted";
  // InboxCA's own locked copy is taken before the file is touched (5.5.1), once the store is set up.
  if (!restoring) {
    const kept = await keepSafetyCopy(membership.firmId, id, () => drive.read(document.drive_file_id)).catch(() => null);
    if (kept === null) redirect(`${back}&error=copy`);
    if (kept) await supabaseAdmin().from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "document.safety_copy", entity_type: "document", entity_id: id });
  }
  const folder = await drive.ensureFolder(
    restoring
      ? folderFor(order, client, { work: document.work_type as WorkType, period: document.period_key, receivedAt: document.received_at, toCheck: status === "to_check" })
      : [DELETED_FOLDER],
  );
  // A file gone from the drive's Deleted folder (emptied in the drive) comes back from the safety copy.
  let copy: Promise<Uint8Array | null> | undefined;
  const place = async (name: string) => {
    try {
      return await drive.move(document.drive_file_id, folder, name);
    } catch (error) {
      const bytes = restoring ? await (copy ??= openSafetyCopy(membership.firmId, id)) : null;
      if (!bytes) throw error;
      return drive.save(folder, name, bytes);
    }
  };
  const wanted = restoring ? (from?.name ?? document.name) : document.name;
  const first = await place(wanted);
  const placed =
    first !== "taken"
      ? { id: first.id, name: wanted }
      : await placeUnderFreeName({ client, type: document.document_type, period: periodName(document.period_key), extension: path.extname(document.name) }, receivedLabel(document.received_at), place, naming);
  if (placed === "taken") redirect(`${back}&error=drive`);
  await supabaseAdmin().rpc("remove_document", { target: id, actor: userId, new_status: status, new_name: placed.name, new_file: placed.id });
  if (copy && (await copy)) await supabaseAdmin().from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "document.safety_restored", entity_type: "document", entity_id: id });
  // Removing the current version brings back the latest earlier one; putting it back makes it current again.
  await settleVersions(supabaseAdmin(), { client_id: clientId, ...document });
  await spendGrant(grant);
  revalidatePath("/app", "layout");
  redirect(restoring ? `${back}&restored=${id}` : `${back}&removed=${id}`);
}

// Asks a client for files for one period (PLAN.md 5.3.1, 8.6). Every member may. The client
// gets a private upload link, sent from the firm's own mailbox to the client's registered
// email when both exist; the link works for 30 days and only its hash is kept, so the
// person sees it once to send it themselves otherwise.
export async function askForDocuments(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  const { data: client } = await supabase.from("clients").select("id, name, email_enc, kind").eq("id", String(form.get("client") ?? "")).maybeSingle();
  if (!membership || !client) redirect("/app");
  const back = `/app/clients/${client.id}?tab=files`;
  const period = String(form.get("period") ?? "");
  const named = form.getAll("item").map(String);
  const others = String(form.get("others") ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name && name.length <= 80);
  const kindList = kindChecklist(membership.settings, client.kind);
  const items = [
    ...named.flatMap((value) => {
      const [work, type] = value.split(":");
      if (work === "kind") return kindList.includes(type) ? [{ type, work: workOfType(type), received: [] as string[] }] : [];
      return work in workTypes && checklists[work as WorkType]?.includes(type) ? [{ type, work: work as WorkType, received: [] as string[] }] : [];
    }),
    ...others.map((type) => ({ type, work: "other" as WorkType, received: [] as string[] })),
  ].filter((item, at, all) => all.findIndex((other) => other.type === item.type) === at);
  // Which GSTIN the GST papers are for, when the client has more than one.
  const registration = String(form.get("registration") ?? "");
  const { data: gstin } = registration ? await supabase.from("client_registrations").select("id").eq("firm_id", membership.firmId).eq("client_id", client.id).eq("kind", "gstin").eq("id", registration).maybeSingle() : { data: null };
  if (!items.length || items.length > 30 || (period && !periodChoices(todayInIndia()).includes(period)) || (registration && !gstin)) redirect(`${back}&ask=1&error=ask`);
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
    // The token itself is kept encrypted with the firm's key, only so follow-ups can send the same link.
    details: { period, items, link_hash: createHash("sha256").update(token).digest("hex"), link_enc: await serverCrypto().encrypt(membership.firmId, `requests/${id}/link`, token), ...(gstin && { registration: gstin.id }) },
  });
  if (error) redirect(`${back}&ask=1&error=ask`);
  await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "request.created", entity_type: "request", entity_id: id });
  const link = `${process.env.APP_BASE_URL ?? (await headers()).get("origin") ?? ""}/u/${token}`;

  // Sent from the firm's mailbox to the client's registered address, if both are there.
  const mailer = await firmMailer(membership.firmId, membership.firmName);
  const to = client.email_enc && (await serverCrypto().decrypt(membership.firmId, `clients/${client.id}/email`, client.email_enc));
  const message=emailTemplates.request(client.name,membership.firmName,period,items,link);
  const sent=!!mailer && !!to && await mailer.send(to,message.subject,message.text);
  revalidatePath("/app", "layout");
  // The link is shown once, in the address, only when it could not be emailed.
  redirect(sent ? `${back}&asked=sent` : `${back}&asked=${encodeURIComponent(link)}`);
}

// The owner, a partner or a manager changes the firm's usual list for this kind of client,
// one paper a line; an empty list goes back to the practice list (firms.settings.checklists).
export async function saveChecklist(form: FormData) {
  const { supabase, membership } = await currentWriter();
  if (!membership) redirect("/app");
  const { data: client } = await supabase.from("clients").select("id, kind").eq("firm_id", membership.firmId).eq("id", String(form.get("client") ?? "")).maybeSingle();
  if (!client) redirect("/app");
  const back = `/app/clients/${client.id}?tab=files&ask=1`;
  if (!canManageClients(membership.role)) redirect(`${back}&error=needs`);
  const items = [...new Set(String(form.get("items") ?? "").split("\n").map((line) => line.trim()).filter(Boolean))];
  if (items.length > 30 || items.some((item) => item.length > 80 || item.includes(":"))) redirect(`${back}&error=list`);
  const lists = { ...(membership.settings.checklists as Record<string, string[]> | undefined) };
  if (items.length) lists[client.kind] = items;
  else delete lists[client.kind];
  await supabaseAdmin().from("firms").update({ settings: { ...membership.settings, checklists: lists } }).eq("id", membership.firmId);
  revalidatePath("/app", "layout");
  redirect(`${back}&changed=list`);
}

// A file the client uploads through their private link, against one item asked for. The
// link must be current and the request still open. Up to 50 MB a file and 100 files a request,
// each checked by the file worker first; each file in a ZIP counts for the item.
// The page sends a pick of several files one at a time, with more set on all but the last,
// so the request closes only after the whole pick is in. It says what happened.
export async function uploadToRequest(form: FormData): Promise<"got" | "file" | "full" | "later" | "closed" | "unsafe"> {
  const token = String(form.get("token") ?? "");
  const admin = supabaseAdmin();
  const { data: request } = await admin
    .from("requests")
    .select("id, firm_id, client_id, status, expires_at, details, clients(id, name), firms(name)")
    .eq("kind", "documents")
    .eq("details->>link_hash", createHash("sha256").update(token).digest("hex"))
    .maybeSingle();
  if (!request?.clients || request.status !== "pending" || Date.parse(request.expires_at ?? "") < Date.now()) return "closed";
  const details = request.details as unknown as DocumentRequest;
  const item = details.items[Number(form.get("item"))];
  const file = form.get("file");
  if (details.items.reduce((sum, entry) => sum + entry.received.length, 0) >= 100) return "full";
  if (!item || !(file instanceof File) || !file.size || file.size > MAX_UPLOAD) return "file";
  const opened = await firmDrive(request.firm_id);
  if (!opened) return "later";
  const sent = await receive(request.firm_id, null, request.clients, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, opened.drive).catch(() => null);
  if (!sent) return "later";
  if ("unsafe" in sent) return "unsafe";
  const before = item.received.length;
  for await (const paper of sent.papers) {
    if (details.items.reduce((sum, entry) => sum + entry.received.length, 0) >= 100) break;
    const saved = await saveForClient(
      { firmId: request.firm_id },
      null,
      request.clients,
      { work_type: item.work, document_type: item.type, period_key: details.period, status: "filed", registration_id: details.registration },
      paper,
      opened,
      sent.scanned,
    );
    if (saved === "drive") return "later";
    if (saved !== "twin") item.received.push(saved.id);
  }
  // A paper from the client answers the asking: its follow ups count again from today.
  if (item.received.length > before && details.followups?.length) Object.assign(details, { followups: [], since: todayInIndia() });
  const done = !form.get("more") && details.items.every((entry) => entry.received.length > 0);
  await admin.from("requests").update({ details: details as unknown as NonNullable<Json>, status: done ? "done" : "pending" }).eq("id", request.id);
  // One emailed receipt a sitting: each file moves the waiting receipt 10 minutes on, and the
  // last paper asked for sends it at once.
  const at = new Date(Date.now() + (done ? 0 : 600_000)).toISOString();
  const { data: moved } = await admin.from("jobs").update({ run_at: at }).eq("kind", "upload_receipt").eq("entity_type", "request").eq("entity_id", request.id).eq("state", "pending").select("id");
  if (!moved?.length) await admin.from("jobs").insert({ firm_id: request.firm_id, kind: "upload_receipt", entity_type: "request", entity_id: request.id, run_at: at, idempotency_key: `upload_receipt:${request.id}:${randomUUID()}` });
  if (done) runJobsSoon();
  return "got";
}

// A person checks a file the client sent for an item asked for (PLAN.md 5.3.1). Checked keeps
// it; Ask again leaves the file filed but clears the item, so the client's link asks for it
// once more, reminders count it as missing, and the request is open again.
export async function checkRequestItem(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  if (!membership) redirect("/app");
  const { data: request } = await supabase.from("requests").select("id, client_id, details").eq("firm_id", membership.firmId).eq("kind", "documents").eq("id", String(form.get("request") ?? "")).maybeSingle();
  if (!request) redirect("/app");
  const back = `/app/clients/${request.client_id}?tab=files`;
  const details = request.details as unknown as DocumentRequest;
  const item = details.items[Number(form.get("item"))];
  if (!item?.received.length) redirect(back);
  if (form.get("intent") === "again") {
    item.received = [];
    delete item.checked;
  } else item.checked = true;
  const admin = supabaseAdmin();
  await admin.from("requests").update({ details: details as unknown as NonNullable<Json>, status: details.items.every((entry) => entry.received.length) ? "done" : "pending" }).eq("id", request.id);
  await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "request.changed", entity_type: "request", entity_id: request.id });
  revalidatePath("/app", "layout");
  redirect(back);
}

// Sends a filed document to the client, or to one of its contacts allowed to receive
// documents (PLAN.md 5.10, 8.6): a secure link from the firm's mailbox that works for 7 days
// and 5 downloads. The owner, a partner or a manager may send; each send is recorded.
export async function sendDocument(form: FormData) {
  const { id, userId, membership, back, document, clientId } = await visibleDocument(form);
  // Sending to a client is a request unless the owner switched it on for this role (5.17.2).
  const grant = membership.may("send", clientId) ? null : await grantFor(membership.firmId, userId, "send", clientId, id);
  if (!membership.may("send", clientId) && !grant) redirect(`${back}&error=needs`);
  const admin = supabaseAdmin();
  const { data: owner } = await admin.from("documents").select("client_id, clients(name, email_enc)").eq("id", id).single();
  const crypto = serverCrypto();
  const recipient = String(form.get("to") ?? "");
  let to = "";
  let contact: string | null = null;
  if (recipient === "client" && owner?.clients?.email_enc) to = await crypto.decrypt(membership.firmId, `clients/${owner.client_id}/email`, owner.clients.email_enc);
  else {
    const { data: link } = await admin.from("contact_clients").select("contact_id, contacts(email_enc)").eq("client_id", owner?.client_id ?? "").eq("contact_id", recipient).eq("can_receive_documents", true).maybeSingle();
    if (link?.contacts) {
      to = await crypto.decrypt(membership.firmId, `contacts/${link.contact_id}/email`, link.contacts.email_enc);
      contact = link.contact_id;
    }
  }
  if (!to) redirect(`${back}&send=${id}&error=recipient`);
  const records = (membership.settings.records ?? {}) as RecordsSettings;
  const sent = await sendShare({
    firmId: membership.firmId,
    firmName: membership.firmName, actor: userId,
    documentId: id,
    documentName: document.name,
    clientName: owner?.clients?.name ?? "",
    contactId: contact,
    to,
    needsCode: paperPolicy(document, records) === "approval",
  });
  if (!sent) redirect(`${back}&send=${id}&error=mailbox`);
  await spendGrant(grant);
  revalidatePath("/app", "layout");
  redirect(`${back}&shared=${id}`);
}

// Documents: the papers chosen there, each sent to its own client's email as a secure link,
// after the preview of who gets what. As one at a time, the papers must be filed and not kept
// inside the firm, and the person must be allowed to send for the client; others are skipped.
export async function sendPapers(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  if (!membership) redirect("/app");
  const asked = String(form.get("back") ?? "");
  const back = asked.startsWith("/app/documents") ? asked : "/app/documents";
  const ids = [...new Set(form.getAll("pick").map(String))];
  if (!ids.length || ids.length > 20 || ids.some((id) => !z.uuid().safeParse(id).success)) redirect(back);
  const { data: papers } = await supabase.from("documents").select("id, client_id, name, status, share_policy, document_type, clients(name, email_enc)").eq("firm_id", membership.firmId).in("id", ids);
  const records = (membership.settings.records ?? {}) as RecordsSettings;
  const crypto = serverCrypto();
  let sent = 0;
  for (const paper of papers ?? []) {
    const policy = paperPolicy(paper, records);
    if (!membership.may("send", paper.client_id) || paper.status !== "filed" || policy === "internal" || !paper.clients?.email_enc) continue;
    const to = await crypto.decrypt(membership.firmId, `clients/${paper.client_id}/email`, paper.clients.email_enc);
    if (await sendShare({ firmId: membership.firmId, firmName: membership.firmName, actor: userId, documentId: paper.id, documentName: paper.name, clientName: paper.clients.name, contactId: null, to, needsCode: policy === "approval" })) sent++;
  }
  revalidatePath("/app", "layout");
  redirect(`${back}${back.includes("?") ? "&" : "?"}sent=${sent}-${ids.length - sent}`);
}

// Settings → Firm drive: the order of the folders new files go into (§5.5.0). Files already
// filed stay where they are. The owner's choice.
export async function setFolderOrder(form: FormData) {
  const { userId, membership } = await currentWriter();
  const order = String(form.get("order") ?? "");
  const naming = String(form.get("naming") ?? "client_type_period");
  if (membership?.role !== "owner" || !(folderOrders as readonly string[]).includes(order) || !(naming in namings)) redirect("/app/settings?group=email");
  const admin = supabaseAdmin();
  const { data: account } = await admin.from("connected_accounts").select("id, settings").eq("firm_id", membership.firmId).eq("kind", "drive").maybeSingle();
  if (account) {
    await admin.from("connected_accounts").update({ settings: { ...(account.settings as object), folder_order: order, naming } }).eq("id", account.id);
    await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "drive.folder_order", entity_type: "account", entity_id: account.id, details: { order, naming } });
  }
  revalidatePath("/app/settings");
}

// The first import (PLAN.md 5.16): the owner approves moving past files already in the
// drive into their client folders. The plan is worked out again here from the drive itself,
// with the client the owner chose for each folder that did not match; only files with a
// client move, up to 5,000 an import. A job moves them; Undo puts them back.
export async function startImport(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  if (membership?.role !== "owner") redirect("/app");
  const opened = await firmDrive(membership.firmId);
  if (!opened) redirect("/app/import?error=drive");
  const own = await opened.drive.folders();
  const folders = form.getAll("folder").map(String).filter((folder) => own.includes(folder));
  const scope = (["final", "year", "all"].includes(String(form.get("scope"))) ? String(form.get("scope")) : "final") as Scope;
  const clients = await activeClients(supabase);
  const known = new Set(clients.map((client) => client.id));
  const chosen = Object.fromEntries(
    [...form.entries()].flatMap(([key, value]) => (key.startsWith("map:") && known.has(String(value)) ? [[key.slice(4), String(value)]] : [])),
  );
  const listed = (await Promise.all(folders.map((folder) => opened.drive.files(folder)))).flat();
  const { data: firm } = await supabaseAdmin().from("firms").select("created_at").eq("id", membership.firmId).single();
  const files = planImport(listed, clients ?? [], scope, String(form.get("year") ?? ""), todayInIndia(), chosen, importSince(firm?.created_at ?? "", todayInIndia()))
    .filter((file): file is Planned & { client: string } => !!file.client)
    .slice(0, 5000);
  if (!files.length) redirect("/app/import?error=none");
  const id = randomUUID();
  const admin = supabaseAdmin();
  await admin.from("requests").insert({ id, firm_id: membership.firmId, kind: "import", entity_type: "import", entity_id: id, details: { files, done: 0, moved: [] } as unknown as NonNullable<Json> });
  await admin.from("jobs").insert({ firm_id: membership.firmId, kind: "import_files", entity_type: "request", entity_id: id, idempotency_key: `import_files:${id}:0` });
  await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "import.started", entity_type: "request", entity_id: id, details: { files: files.length, scope } });
  redirect("/app/import?started=1");
}

export async function undoFirstImport(form: FormData) {
  const { userId, membership } = await currentWriter();
  if (membership?.role !== "owner") redirect("/app");
  const admin = supabaseAdmin();
  const { data: request } = await admin.from("requests").select("id").eq("id", String(form.get("import") ?? "")).eq("firm_id", membership.firmId).eq("kind", "import").maybeSingle();
  if (request) {
    // Stop any batch still to move, then put back what has moved.
    await admin.from("requests").update({ status: "done" }).eq("id", request.id);
    await admin.from("jobs").insert({ firm_id: membership.firmId, kind: "undo_import", entity_type: "request", entity_id: request.id, idempotency_key: `undo_import:${request.id}:start` });
    await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "import.undo_asked", entity_type: "request", entity_id: request.id });
  }
  redirect("/app/import?undoing=1");
}

// The uploader for files on a disk (PLAN.md 5.16), the owner's. First each file's kind, by
// the same rules as the import (a final paper or not, its year), from its name and folders
// only, leaving out what the first 14 days hold back; so each choice shows its size.
export async function describeDiskFiles(paths: string[]) {
  const { membership } = await currentMember();
  if (membership?.role !== "owner") return [];
  const today = todayInIndia();
  const { data: firm } = await supabaseAdmin().from("firms").select("created_at").eq("id", membership.firmId).single();
  const since = importSince(firm?.created_at ?? "", today);
  return paths.slice(0, 1000).map((name) => {
    const [file] = planImport([{ id: "", path: String(name), size: 0 }], [], "all", "", today, {}, since);
    return file ? { final: inScope(file, "final", ""), year: file.year } : null;
  });
}

// Then each file goes from the browser straight into the drive's Incoming folder, by a
// one-time link. A file already there with the same checksum is done, so an upload broken
// off picks up where it stopped; another file by that name is left as it is.
export async function incomingLinks(files: { path: string; hash: string }[]) {
  const { membership } = await currentWriter();
  const opened = membership?.role === "owner" ? await firmDrive(membership.firmId) : null;
  if (!opened) return [];
  return Promise.all(
    files.slice(0, 20).map(async (file) => {
      const relative = incomingPath(String(file.path));
      const there = await opened.drive.incomingFile(relative);
      return there ? (there.hash === file.hash ? "done" : "taken") : opened.drive.incomingLink(relative);
    }),
  );
}

// After it is sent, the drive's checksum of each file must be the browser's; a file that
// differs is removed so it can be sent again.
export async function checkIncoming(files: { path: string; hash: string }[]) {
  const { membership } = await currentWriter();
  const opened = membership?.role === "owner" ? await firmDrive(membership.firmId) : null;
  if (!opened) return [];
  return Promise.all(
    files.slice(0, 20).map(async (file) => {
      const there = await opened.drive.incomingFile(incomingPath(String(file.path)));
      if (there && there.hash !== file.hash) await opened.drive.trash(there.id);
      return there?.hash === file.hash;
    }),
  );
}

// Inbox → Papers waiting for approval (PLAN.md 5.5.2): a private paper a client asked for
// goes only after one approval by the owner, a partner or a manager; or it is not sent.
export async function decideShare(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  if (!membership || !canManageClients(membership.role)) redirect("/app/inbox");
  const { data: share } = await supabase.from("shares").select("id, document_id, contact_id, email_event_id, status").eq("id", String(form.get("share") ?? "")).eq("status", "waiting").maybeSingle();
  if (!share) redirect("/app/inbox");
  const admin = supabaseAdmin();
  if (form.get("intent") === "refuse") {
    await admin.from("shares").update({ status: "refused" }).eq("id", share.id);
    await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "share.refused", entity_type: "document", entity_id: share.document_id });
    revalidatePath("/app", "layout");
    redirect("/app/inbox");
  }
  const [{ data: document }, { data: event }] = await Promise.all([
    admin.from("documents").select("name, client_id, clients(name, email_enc)").eq("id", share.document_id).single(),
    admin.from("email_events").select("provider_message_id").eq("id", share.email_event_id ?? "").maybeSingle(),
  ]);
  const crypto = serverCrypto();
  let to = "";
  if (share.contact_id) {
    const { data: contact } = await admin.from("contacts").select("email_enc").eq("id", share.contact_id).single();
    if (contact) to = await crypto.decrypt(membership.firmId, `contacts/${share.contact_id}/email`, contact.email_enc);
  } else if (document?.clients?.email_enc) to = await crypto.decrypt(membership.firmId, `clients/${document.client_id}/email`, document.clients.email_enc);
  const sent =
    !!to &&
    !!document &&
    (await sendShare({
      firmId: membership.firmId,
      firmName: membership.firmName, actor: userId,
      documentId: share.document_id,
      documentName: document.name,
      clientName: document.clients?.name ?? "",
      contactId: share.contact_id,
      to,
      emailEventId: share.email_event_id,
      inReplyTo: event?.provider_message_id,
      waitingId: share.id,
      needsCode: true,
    }));
  if (sent) await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "share.approved", entity_type: "document", entity_id: share.document_id });
  revalidatePath("/app", "layout");
  redirect(sent ? "/app/inbox?approved=1" : "/app/inbox?error=mailbox");
}

// Settings → Papers sent on request: which document types go at once when a client asks,
// or that every paper waits for approval. The owner's choice.
export async function saveRecords(form: FormData) {
  const { supabase, membership } = await currentWriter();
  if (membership?.role !== "owner") redirect("/app");
  const routine = form.getAll("routine").map(String).filter((type) => documentTypes.includes(type));
  await supabase.from("firms").update({ settings: { ...membership.settings, records: { routine, approve_all: form.get("approve_all") === "on" } } }).eq("id", membership.firmId);
  redirect("/app/settings?group=reminders&saved=records#records");
}

// The notice tracker (PLAN.md 5.6): a person records a notice by hand, confirms its action
// date against the notice (only then is it the deadline), or moves it on: in progress,
// replied, closed. Every member may add one; confirming its date and moving it on are for
// the owner, partners and managers, as is changing clients. Notices follow the client's visibility.
export async function manageNotice(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  if (!membership) redirect("/app");
  const intent = String(form.get("intent") ?? "");
  const date = String(form.get("date") ?? "");
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date));
  // From a client's Notices tab, the change returns there.
  let back = "/app/notices";
  const decides = canManageClients(membership.role);
  if (intent === "add") {
    const { data: client } = await supabase.from("clients").select("id").eq("firm_id",membership.firmId).eq("id", String(form.get("client") ?? "")).maybeSingle();
    const authority = String(form.get("authority") ?? "other");
    const received = String(form.get("received") ?? "") || todayInIndia();
    if (client && form.get("back") === "client") back = `/app/clients/${client.id}?tab=notices`;
    if (!client || !(authority in authorities) || !/^\d{4}-\d{2}-\d{2}$/.test(received)) redirect(client && back !== "/app/notices" ? `/app/clients/${client.id}?tab=notice&error=notice` : `/app/notices?add=1&error=notice${client ? `&client=${client.id}` : ""}`);
    const details: NoticeDetails = {
      authority: authority as Authority,
      notice_type: String(form.get("type") ?? "").trim().slice(0, 80) || "Other",
      reference: String(form.get("reference") ?? "").trim().toUpperCase().slice(0, 60),
      received_on: received,
      // Anyone else's date waits, as a suggestion, for one of them to confirm it.
      ...(validDate && (decides ? { action_date: date } : { suggested_date: date })),
    };
    const settings = membership.settings as { notice_review_days?: number; holidays?: string[] };
    const id = randomUUID();
    await supabaseAdmin().from("tasks").insert({ id, firm_id: membership.firmId, client_id: client.id, kind: "notice", status: "upcoming", due_on: validDate && decides ? date : reviewBy(received, settings.notice_review_days ?? 1, settings.holidays ?? []), details: details as unknown as NonNullable<Json> });
    await supabaseAdmin().from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "notice.added", entity_type: "task", entity_id: id });
  } else {
    const { data: notice } = await supabase.from("tasks").select("id, client_id, details").eq("id", String(form.get("notice") ?? "")).eq("kind", "notice").maybeSingle();
    if (!notice) redirect("/app/notices");
    if (form.get("back") === "client") back = `/app/clients/${notice.client_id}?tab=notices`;
    if (!decides) redirect(back);
    // An empty date opens the notice again, where its field asks for the date.
    if (intent === "confirm" && !validDate) redirect(back === "/app/notices" ? `/app/notices?notice=${notice.id}` : back);
    const details = notice.details as unknown as NoticeDetails;
    // Members never move a due date themselves; a confirmed action date is set by the server, logged.
    if (intent === "confirm") {
      await supabaseAdmin().from("tasks").update({ due_on: date, details: { ...details, action_date: date } as unknown as NonNullable<Json> }).eq("id", notice.id);
      await supabaseAdmin().from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "notice.date_confirmed", entity_type: "task", entity_id: notice.id, details: { date } });
    }
    else if (intent in noticeStatuses) await supabase.from("tasks").update({ status: intent }).eq("id", notice.id);
  }
  revalidatePath("/app", "layout");
  // On the Notices page: back to the same list, with a note of what changed.
  if (back === "/app/notices") back += `?${new URLSearchParams([...["show", "page"].map((key) => [key, String(form.get(key) ?? "")]), ["saved", intent]].filter(([, value]) => value))}`;
  redirect(back);
}

// A forged approval is refused and kept in the firm's activity, too (5.17.4 #44).
async function denyApproval(firmId: string, userId: string, kind: string): Promise<never> {
  await supabaseAdmin().from("activity_log").insert({ firm_id: firmId, actor_id: userId, action: "approval.denied", entity_type: "firm", entity_id: firmId, details: { kind } });
  redirect("/app");
}

// What office_control's refusals mean for the panel's note (office-panel.tsx).
const officeRefusals: Record<string, string> = {
  "No connection to confirm": "no_line",
  "The firm is closed for today": "closed",
  "Choose up to two active partners": "deputies",
  "The co-admin must be a deputy": "deputies",
  "PC is not approved": "pc",
  "Ask another approver": "self",
};

// Office changes are checked and logged together in the database.
export async function setOfficeOnly(form: FormData) {
  const { userId, membership } = await currentWriter();
  if (!membership) redirect("/app");
  if (!officeApprover(membership.role, userId, membership.settings)) await denyApproval(membership.firmId, userId, "office");
  const decision = String(form.get("intent") ?? "");
  const line = requestLine(await headers(), todayInIndia());
  // The co-admin is always one of the deputies.
  const coAdmin = String(form.get("co_admin") ?? "");
  const deputies = [...new Set([...form.getAll("deputy").map(String), ...(coAdmin ? [coAdmin] : [])])];
  const request = String(form.get("request") ?? "");
  if (decision === "deputies" && deputies.length > 2) redirect("/app/settings?group=access&error=deputies#office");
  // The owner's provider gives no fixed connection: stop suggesting it (5.8).
  if (decision === "no_fixed") {
    if (!firmAdmin(membership.role, userId, membership.settings)) redirect("/app");
    const office = (membership.settings.office ?? {}) as Record<string, unknown>;
    await (await currentWriter()).supabase.from("firms").update({ settings: { ...membership.settings, office: { ...office, fixed_declined: true } } }).eq("id", membership.firmId);
    await supabaseAdmin().from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "office.no_fixed", entity_type: "firm", entity_id: membership.firmId });
    redirect("/app/settings?group=access#office");
  }
  // A branch's own office, when the firm has branches (5.17.4 #13).
  const branch = String(form.get("branch") ?? "");
  if (request && !z.uuid().safeParse(request).success || branch && !z.uuid().safeParse(branch).success || deputies.some((id) => !z.uuid().safeParse(id).success)) redirect("/app");
  const { error } = await supabaseAdmin().rpc("office_control", {
    target_firm: membership.firmId, actor: userId, decision,
    ...(request && { request_id: request }),
    ...(branch && { branch }),
    ...((decision === "here" || decision === "fixed" || decision === "on" && form.get("here") === "yes") && line && { connection: line }),
    ...(decision === "deputies" && { deputies, ...(coAdmin && { co_admin: coAdmin }) }),
  });
  // A choice the database refuses (no address seen, the office already closed, a deputy who
  // is not an active partner) comes back as a note on the panel, not a broken page.
  const refused = error && (Object.entries(officeRefusals).find(([text]) => error.message.includes(text))?.[1] ?? "office");
  if (!refused) revalidatePath("/app", "layout");
  redirect(`/app/settings?group=access${branch ? `&branch=${branch}` : ""}${refused ? `&error=${refused}` : ""}#office`);
}

// The owner decides whether a waiting PC stays in the office, travels, or is refused.
export async function reviewDevice(form: FormData) {
  const { userId, membership } = await currentWriter();
  if (!membership) redirect("/app");
  if (!officeApprover(membership.role, userId, membership.settings)) await denyApproval(membership.firmId, userId, "pc");
  const decision = String(form.get("decision") ?? "");
  const device = String(form.get("device") ?? "");
  const until = String(form.get("until") ?? "");
  // Approve all covers the PCs of the office shown: a branch's own, else the main office's.
  const branch = String(form.get("branch") ?? "");
  const back = `/app/settings?group=access${z.uuid().safeParse(branch).success ? `&branch=${branch}` : ""}#office`;
  if (!["office", "laptop", "personal", "refuse", "withdraw"].includes(decision) || (device && !z.uuid().safeParse(device).success) || (branch && !z.uuid().safeParse(branch).success) || (decision === "personal" && !z.iso.date().safeParse(until).success)) redirect(back);
  const { error } = await supabaseAdmin().rpc("review_devices", {
    target_firm: membership.firmId,
    actor: userId,
    target_device: device || "00000000-0000-0000-0000-000000000000",
    decision,
    ...(decision === "personal" && { until_day: until }),
    ...(branch && { branch }),
  });
  if (error) throw new Error(`Device review failed: ${error.code}`);
  revalidatePath("/app");
  redirect(back);
}

// Permission requests (PLAN.md 5.17.2): asked by an employee or manager who may not do it
// themselves, answered by their team's manager or by the owner or a deputy, as routeOf
// says. Allow once is a grant for one use within an hour.
const isDeputy = (settings: Record<string, unknown>, userId: string) => ((settings.office as { deputies?: string[] } | undefined)?.deputies ?? []).includes(userId);

const spendGrant = (id: string | null) => (id ? supabaseAdmin().from("requests").update({ status: "used" }).eq("id", id) : null);

export async function askPermission(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  if (!membership) redirect("/app");
  const right = String(form.get("right") ?? "") as Right;
  if(!["upload","send","edit_figures","download","remove"].includes(right)) redirect("/app");
  const { data: client } = await supabase.from("clients").select("id").eq("firm_id",membership.firmId).eq("id", String(form.get("client") ?? "")).maybeSingle();
  const documentId = String(form.get("document") ?? "") || undefined;
  if (!client || !(right in rightWords)) redirect("/app");
  const back = `/app/clients/${client.id}?tab=${right==="edit_figures" ? "extraction" : "files"}`;
  const admin = supabaseAdmin();
  const [{ data: me }, { data: pending }] = await Promise.all([
    admin.from("firm_members").select("role, team_id").eq("firm_id", membership.firmId).eq("user_id", userId).single(),
    admin.from("requests").select("id").eq("firm_id", membership.firmId).eq("kind", "permission").eq("status", "pending").eq("details->>by", userId).gt("expires_at", new Date().toISOString()),
  ]);
  // A few open requests at a time, so nobody floods their manager.
  if (!me || (pending?.length ?? 0) >= 10) redirect(`${back}&error=asked`);
  const { data: managers } = me.team_id ? await admin.from("firm_members").select("user_id,role,access").eq("firm_id", membership.firmId).eq("team_id", me.team_id).in("role", ["manager","partner"]).eq("status", "active").neq("user_id", userId) : { data: [] };
  const document = documentId ? (await supabase.from("documents").select("id, name").eq("id", documentId).eq("client_id", client.id).maybeSingle()).data : null;
  const id = randomUUID();
  await admin.from("requests").insert({
    id,
    firm_id: membership.firmId,
    kind: "permission",
    client_id: client.id,
    entity_type: "permission",
    entity_id: id,
    reason_code: right,
    expires_at: new Date(Date.now() + 4 * 3_600_000).toISOString(),
    details: { by: userId, route: routeOf(right, me, managers?.filter(manager=>may(manager.role,"approve_requests",membership.settings.permissions as Permissions,((manager.access as {always?:Standing[]})?.always ?? []),client.id)).map(manager=>manager.user_id) ?? []), team_id: me.team_id, ...(document && { document_id: document.id, document_name: document.name }) },
  });
  await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "permission.asked", entity_type: "request", entity_id: id, details: { right } });
  runJobsSoon();
  revalidatePath("/app", "layout");
  redirect(`${back}&asked_right=${right}`);
}

export async function decidePermission(form: FormData) {
  const { userId, membership } = await currentWriter();
  if (!membership) redirect("/app");
  const admin = supabaseAdmin();
  const { data: request } = await admin.from("requests").select("id, client_id, details, reason_code").eq("id", String(form.get("request") ?? "")).eq("firm_id", membership.firmId).eq("kind", "permission").eq("status", "pending").gt("expires_at", new Date().toISOString()).maybeSingle();
  const { data: me } = await admin.from("firm_members").select("role, team_id").eq("firm_id", membership.firmId).eq("user_id", userId).single();
  const asked = request?.details as { by: string; route: "owner" | "manager"; team_id: string | null } | undefined;
  if (!request || !me || !asked) redirect("/app/inbox");
  if (!mayDecide({ id: userId, role: me.role, team_id: me.team_id, deputy: isDeputy(membership.settings, userId) }, asked)) await denyApproval(membership.firmId, userId, "permission");
  if(["manager","partner"].includes(me.role) && !isDeputy(membership.settings,userId) && !membership.may("approve_requests",request.client_id ?? undefined)) await denyApproval(membership.firmId,userId,"permission");
  const intent = String(form.get("intent") ?? "");
  // Always allow is the owner's or a deputy's, for uploading or sending (5.17.2): that
  // person may do it from now on, until it is withdrawn in Settings → Permissions.
  if (intent === "always") {
    if (me.role !== "owner" || !(request.reason_code && Object.hasOwn(switchable,request.reason_code))) await denyApproval(membership.firmId, userId, "always");
    const { data: person } = await admin.from("firm_members").select("access").eq("firm_id", membership.firmId).eq("user_id", asked.by).single();
    const access = (person?.access ?? {}) as { always?: Standing[] };
    const scope=await permissionScope(form,"",membership.firmId);
    const always=(access.always ?? []).filter(grant=>(typeof grant==="string" ? grant : grant.right)!==request.reason_code);
    await admin.from("firm_members").update({ access: { ...access, always: [...always,{right:request.reason_code!,...scope}] } }).eq("firm_id", membership.firmId).eq("user_id", asked.by);
    await admin.from("requests").update({ status: "used" }).eq("id", request.id);
    await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "permission.always", entity_type: "request", entity_id: request.id, details: { right: request.reason_code, for: asked.by } });
    revalidatePath("/app", "layout");
    redirect(`/app/inbox?decided=${request.id}`);
  }
  const allow = intent === "allow";
  // More time is given at once: that person's extra time today, which the database reads.
  const time = request.reason_code === "time" ? (request.details as { day: string; until: string }) : null;
  if (allow && time) {
    const { data: person } = await admin.from("firm_members").select("access").eq("firm_id", membership.firmId).eq("user_id", asked.by).single();
    await admin.from("firm_members").update({ access: { ...(person?.access as object), extra_time: { day: time.day, until: time.until } } }).eq("firm_id", membership.firmId).eq("user_id", asked.by);
  }
  await admin.from("requests").update(allow ? (time ? { status: "used" } : { status: "approved", expires_at: new Date(Date.now() + 3_600_000).toISOString() }) : { status: "refused" }).eq("id", request.id);
  await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: allow ? "permission.allowed" : "permission.refused", entity_type: "request", entity_id: request.id, details: { right: request.reason_code, for: asked.by } });
  revalidatePath("/app", "layout");
  redirect(`/app/inbox?decided=${request.id}`);
}

// Undo, from the toast after answering: only the person who answered, within a few minutes,
// and not once an Allow once was used or more time was given. The question waits again; an
// Always allow given with it is taken back.
export async function undoPermission(form: FormData) {
  const { userId, membership } = await currentWriter();
  if (!membership) redirect("/app");
  const admin = supabaseAdmin();
  const id = String(form.get("request") ?? "");
  const [{ data: request }, { data: last }] = await Promise.all([
    admin.from("requests").select("id, status, reason_code, details").eq("id", id).eq("firm_id", membership.firmId).eq("kind", "permission").neq("reason_code", "time").gt("expires_at", new Date().toISOString()).maybeSingle(),
    admin.from("activity_log").select("action, actor_id").eq("firm_id", membership.firmId).eq("entity_type", "request").eq("entity_id", id).gt("at", new Date(Date.now() - 15 * 60_000).toISOString()).order("at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const undoable = { "permission.allowed": "approved", "permission.refused": "refused", "permission.always": "used" } as Record<string, string>;
  if (!request || last?.actor_id !== userId || undoable[last.action] !== request.status) redirect("/app/inbox");
  const by = (request.details as { by: string }).by;
  if (last.action === "permission.always") {
    const { data: person } = await admin.from("firm_members").select("access").eq("firm_id", membership.firmId).eq("user_id", by).single();
    const access = (person?.access ?? {}) as { always?: Standing[] };
    await admin.from("firm_members").update({ access: { ...access, always: (access.always ?? []).filter((grant) => (typeof grant === "string" ? grant : grant.right) !== request.reason_code) } }).eq("firm_id", membership.firmId).eq("user_id", by);
  }
  await admin.from("requests").update({ status: "pending" }).eq("id", request.id);
  await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "permission.undone", entity_type: "request", entity_id: request.id, details: { right: request.reason_code, for: by } });
  revalidatePath("/app", "layout");
  redirect("/app/inbox");
}

// Settings → Permissions (owner only): the rights the owner switches on for employees and
// for managers (partners follow managers), or back to the defaults.
export async function savePermissions(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  if (!membership || !firmAdmin(membership.role, userId, membership.settings)) redirect("/app");
  const permissions:Permissions={};
  try {if(form.get("intent")!=="reset") for(const column of ["employee","manager"] as const) permissions[column]={...Object.fromEntries(Object.keys(switchable).map(right=>[right,form.get(`${column}:${right}`)==="on"])),scope:await permissionScope(form,`${column}:`,membership.firmId)};}
  catch {redirect("/app/settings?group=people&error=permission_scope#permissions");}
  const hideInactive = form.get("intent") !== "reset" && form.get("hide_inactive") === "on";
  // How many days before a due date a return still waiting for papers or checks turns red (5).
  const pinDays = form.get("intent") === "reset" ? 5 : Math.min(30, Math.max(1, Math.round(Number(form.get("pin_days"))) || 5));
  await supabase.from("firms").update({ settings: { ...membership.settings, permissions, second_form_approval:form.get("intent")!=="reset" && form.get("second_form_approval")==="on", viewer_hide_inactive: hideInactive, pin_days: pinDays } }).eq("id", membership.firmId);
  await supabaseAdmin().from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "permissions.changed", entity_type: "firm", entity_id: membership.firmId, details: { permissions, pin_days: pinDays } });
  redirect("/app/settings?group=people&saved=permissions#permissions");
}

async function permissionScope(form:FormData,prefix:string,firm:string) {
  const until=String(form.get(`${prefix}until`) ?? ""),names=[...new Set(String(form.get(`${prefix}clients`) ?? "").split(/\r?\n/).map(name=>name.trim()).filter(Boolean))];
  if(names.length>100 || names.some(name=>name.length>200) || until && (!z.iso.date().safeParse(until).success || until<todayInIndia())) throw new Error("Choose a future end date and up to 100 client names, one per line.");
  const scope:PermissionScope={...(until && {until})};
  if(names.length) {
    const {data,error}=await supabaseAdmin().from("clients").select("id,name").eq("firm_id",firm).in("name",names);
    if(error || data?.length!==names.length || names.some(name=>data.filter(client=>client.name===name).length!==1)) throw new Error("Use each client's full name as shown in Clients. Names must match one client each.");
    scope.clients=data.map(client=>client.id);
  }
  return scope;
}

export async function allowStanding(form:FormData) {
  const {userId,membership}=await currentWriter();
  if(!membership || !firmAdmin(membership.role,userId,membership.settings)) redirect("/app");
  const person=z.uuid().parse(form.get("person")),right=String(form.get("right") ?? "");
  if(!Object.hasOwn(switchable,right) || person===userId) redirect("/app/settings?group=people#permissions");
  const admin=supabaseAdmin(),{data:member}=await admin.from("firm_members").select("access,role").eq("firm_id",membership.firmId).eq("user_id",person).eq("status","active").maybeSingle();
  if(!member || member.role==="owner" || right==="approve_requests" && member.role!=="manager" && member.role!=="partner") redirect("/app/settings?group=people#permissions");
  const access=(member.access ?? {}) as {always?:Standing[]};let scope:PermissionScope;
  try {scope=await permissionScope(form,"",membership.firmId);} catch {redirect("/app/settings?group=people&error=permission_scope#permissions");}
  const always=(access.always ?? []).filter(grant=>(typeof grant==="string" ? grant : grant.right)!==right);
  const {error}=await admin.from("firm_members").update({access:{...access,always:[...always,{right,...scope}]}}).eq("firm_id",membership.firmId).eq("user_id",person);
  if(error) throw new Error("The permission could not be saved.");
  await admin.from("activity_log").insert({firm_id:membership.firmId,actor_id:userId,action:"permission.always",entity_type:"user",entity_id:person,details:{right,for:person,...scope}});
  revalidatePath("/app","layout");
  redirect("/app/settings?group=people&saved=permissions#permissions");
}

// Settings → Permissions: the owner withdraws what one person was always allowed.
export async function withdrawAlways(form: FormData) {
  const { userId, membership } = await currentWriter();
  if (!membership || !firmAdmin(membership.role, userId, membership.settings)) redirect("/app");
  const person = String(form.get("person") ?? "");
  const admin = supabaseAdmin();
  const { data: member } = await admin.from("firm_members").select("access").eq("firm_id", membership.firmId).eq("user_id", person).maybeSingle();
  if (!member) redirect("/app/settings?group=people#permissions");
  await admin.from("firm_members").update({ access: { ...(member.access as object), always: [] } }).eq("firm_id", membership.firmId).eq("user_id", person);
  await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "permission.withdrawn", entity_type: "user", entity_id: person });
  redirect("/app/settings?group=people&saved=permissions#permissions");
}

// A staff member away from the office asks to use this device there (5.17.4 #48).
export async function askAwayDevice() {
  const { userId } = await currentMember();
  await askAway(userId);
  revalidatePath("/app", "layout");
  redirect("/app");
}

// Phone notifications for this browser (5.17.3): the subscription the browser made, kept by
// the server only.
export async function savePushSubscription(json: string) {
  const { userId, membership } = await currentMember();
  const parsed = z.object({ endpoint: z.url({ protocol: process.env.NODE_ENV === "production" ? /^https$/ : /^https?$/ }).max(1000), keys: z.object({ p256dh: z.base64url().max(200), auth: z.base64url().max(100) }) }).safeParse((() => { try { return JSON.parse(json); } catch { return null; } })());
  if (!membership || !parsed.success) return;
  await supabaseAdmin().from("push_subscriptions").upsert({ user_id: userId, endpoint: parsed.data.endpoint, keys: parsed.data.keys }, { onConflict: "endpoint" });
  revalidatePath("/app", "layout");
}

// An office PC's own key (5.17.4 #32, #50): a one-time question for it, then the new key, or
// a check with the key that confirms a changed office connection from that PC.
export async function pcKeyChallenge() {
  const { userId } = await currentMember();
  const pc = await officePc(userId);
  if (!pc) return null;
  const { challenge, cookie } = newChallenge(pc.device.id);
  (await cookies()).set(CHALLENGE_COOKIE, cookie, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 300 });
  return { challenge, deviceId: pc.device.id, keyId: pc.device.key_id };
}

const keyAnswer = z.object({ id: z.base64url().max(400), clientDataJSON: z.base64url().max(4000), authenticatorData: z.base64url().max(4000) });

export async function savePcKey(answer: { id: string; clientDataJSON: string; authenticatorData: string; publicKey: string }) {
  const { userId } = await currentMember();
  const pc = await officePc(userId);
  const parsed = keyAnswer.extend({ publicKey: z.base64url().max(400) }).safeParse(answer);
  if (!pc || pc.device.key_id || !parsed.success) return "This PC's key could not be set up. Reload the page and try again.";
  const result = checkNewKey(parsed.data, (await headers()).get("origin") ?? "", (await cookies()).get(CHALLENGE_COOKIE)?.value, pc.device.id);
  const admin = supabaseAdmin();
  if (result === "synced") {
    // A key that can leave the PC proves nothing about where it is: the PC works as a laptop.
    await admin.from("devices").update({ kind: "laptop" }).eq("id", pc.device.id);
    await admin.from("activity_log").insert({ firm_id: pc.firmId, actor_id: userId, action: "device.key_synced", entity_type: "device", entity_id: pc.device.id });
    revalidatePath("/app", "layout");
    return "This PC keeps its keys in an account that copies them to other devices, so it works as a laptop: a new office connection waits for the owner.";
  }
  if (result !== "ok") return "This PC's key could not be set up. Reload the page and try again.";
  await admin.from("devices").update({ key_id: parsed.data.id, key_public: parsed.data.publicKey }).eq("id", pc.device.id);
  await admin.from("activity_log").insert({ firm_id: pc.firmId, actor_id: userId, action: "device.key_added", entity_type: "device", entity_id: pc.device.id });
  revalidatePath("/app", "layout");
  return "";
}

export async function confirmWithPcKey(answer: { id: string; clientDataJSON: string; authenticatorData: string; signature: string }) {
  const { userId } = await currentMember();
  const pc = await officePc(userId);
  const parsed = keyAnswer.extend({ signature: z.base64url().max(1000) }).safeParse(answer);
  const line = requestLine(await headers(), todayInIndia());
  if (!pc?.device.key_public || !parsed.success || parsed.data.id !== pc.device.key_id || !line
    || !checkKeyUse(parsed.data, pc.device.key_public, (await headers()).get("origin") ?? "", (await cookies()).get(CHALLENGE_COOKIE)?.value, pc.device.id))
    return "This PC's key did not match. Ask the owner or a deputy to confirm the connection.";
  (await cookies()).delete(CHALLENGE_COOKIE);
  const { error } = await supabaseAdmin().rpc("observe_office", { target_firm: pc.firmId, person: userId, pc: pc.device.id, connection: line, proven: true });
  if (error) throw new Error(`Office check failed: ${error.code}`);
  revalidatePath("/app", "layout");
  redirect("/app");
}

// A suspected screen capture in the viewer (PLAN.md 5.17.2): logged; the third in a day by
// one person tells the owner on Home.
export async function logCapture(documentId: string) {
  const { supabase, userId, membership } = await currentMember();
  const { data: document } = await supabase.from("documents").select("id").eq("id", documentId).maybeSingle();
  if (!membership || !document) return;
  await supabaseAdmin().from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "capture_attempt", entity_type: "document", entity_id: document.id });
  await tellOwnerOnRepeat(membership.firmId, userId, membership.email, "capture_attempt", "captures");
}

// Clients: one page of chosen clients, with progress kept on a background request.
export async function sendClientPapers(form: FormData) {
  const {supabase,userId,membership}=await currentWriter();
  if (!membership || !canManageClients(membership.role)) redirect("/app/clients");
  const ids=[...new Set(form.getAll("client").map(String))];
  if(ids.some(id=>!membership.may("send",id))) redirect("/app/clients?error=send_permission");
  const type=String(form.get("type") ?? ""), period=String(form.get("period") ?? "");
  if (!ids.length || ids.length>50 || ids.some((id)=>!z.uuid().safeParse(id).success) || !documentTypes.includes(type) || !/^20\d{2}$/.test(period)) redirect("/app/clients?error=send");
  const {data:clients,error}=await supabase.from("clients").select("id").eq("firm_id",membership.firmId).in("id",ids).is("archived_at",null);
  if (error || clients?.length!==ids.length) redirect("/app/clients?error=send");
  const id=randomUUID();
  const details:BulkSend={by:userId,day:todayInIndia(),type,period,clients:ids.map((id)=>({id,share:randomUUID()}))};
  const {error:saveError}=await supabaseAdmin().from("requests").insert({id,firm_id:membership.firmId,kind:"bulk_send",entity_type:"bulk_send",entity_id:id,details:details as unknown as NonNullable<Json>});
  if (saveError) redirect("/app/clients?error=send");
  await supabaseAdmin().from("activity_log").insert({firm_id:membership.firmId,actor_id:userId,action:"bulk_send.asked",entity_type:"request",entity_id:id,details:{clients:ids.length,type,period}});
  runJobsSoon();
  redirect(`/app/clients?bulk=${id}`);
}

export async function setPaperSharing(form:FormData) {
  const {supabase,userId,membership}=await currentWriter();
  if (membership?.role!=="owner") redirect("/app");
  const policy=String(form.get("policy") ?? "");
  if (!["","auto","approval","internal"].includes(policy)) redirect("/app/clients");
  const {data:document}=await supabase.from("documents").select("id,client_id").eq("firm_id",membership.firmId).eq("id",String(form.get("document") ?? "")).maybeSingle();
  if (!document) redirect("/app/clients");
  const admin=supabaseAdmin();
  const {error}=await admin.from("documents").update({share_policy:policy || null}).eq("firm_id",membership.firmId).eq("id",document.id);
  if (error) redirect(`/app/clients/${document.client_id}?tab=files&error=document`);
  if (policy==="internal") await admin.from("shares").update({status:"refused",link_token_hash:null,link_expires_at:null,delivery:null}).eq("firm_id",membership.firmId).eq("document_id",document.id);
  await admin.from("activity_log").insert({firm_id:membership.firmId,actor_id:userId,action:"document.sharing",entity_type:"document",entity_id:document.id,details:{policy:policy || "firm"}});
  revalidatePath("/app","layout");
  redirect(`/app/clients/${document.client_id}?tab=files&edit=${document.id}&changed=sharing`);
}

export async function saveMailLimit(form:FormData) {
  const {supabase,membership}=await currentWriter();
  if (membership?.role!=="owner") redirect("/app");
  const limit=z.coerce.number().int().min(1).max(2000).safeParse(form.get("limit"));
  if (!limit.success) redirect("/app/settings?group=email&error=mail_limit#mailbox");
  await supabase.from("firms").update({settings:{...membership.settings,mail_limit:limit.data}}).eq("id",membership.firmId);
  revalidatePath("/app/settings");
  redirect("/app/settings?group=email&saved=mail_limit#mailbox");
}

// Today: "Remind all late clients" or "Chase missing papers", after their preview. The daily
// reminder job sends them, from the firm's mailbox, at most one email a client a day; it waits
// 20 seconds so Undo can stop it. Owners and partners only, as they see every client.
export async function sendNow(form: FormData) {
  const { userId, membership } = await currentWriter();
  if (!membership || !["owner", "partner"].includes(membership.role)) redirect("/app");
  const what = form.get("what") === "papers" ? "papers" : "late";
  const admin = supabaseAdmin();
  const { data: job, error } = await admin.from("jobs").insert({ firm_id: membership.firmId, kind: "reminders", entity_type: what, entity_id: membership.firmId, idempotency_key: `reminders:${what}:${membership.firmId}:${randomUUID()}`, run_at: new Date(Date.now() + 20_000).toISOString() }).select("id").single();
  if (error) redirect("/app?error=send");
  await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: `reminders.asked`, entity_type: "firm", entity_id: membership.firmId, details: { what } });
  redirect(`/app?sending=${what}&job=${job.id}`);
}

// Undo on the toast: the send stops if it has not started yet. One client's reminder (the
// Calendar, the client's Returns tab, a paper item) may be stopped by whoever may send it.
export async function stopSend(form: FormData) {
  const { supabase, membership } = await currentWriter();
  const one = form.has("client");
  if (!membership) redirect("/app");
  const { data: client } = one ? await supabase.from("clients").select("id").eq("firm_id", membership.firmId).eq("id", String(form.get("client") ?? "")).maybeSingle() : { data: null };
  const mayStop = one ? !!client && (canManageClients(membership.role) || !!(await supabase.rpc("looks_after", { target_firm: membership.firmId, client: client.id })).data) : ["owner", "partner"].includes(membership.role);
  if (!mayStop) redirect("/app");
  let jobs = supabaseAdmin().from("jobs").update({ state: "cancelled" }).eq("firm_id", membership.firmId).eq("kind", "reminders").eq("state", "pending").eq("id", Number(form.get("job")));
  if (one) jobs = jobs.eq("entity_type", "client").eq("entity_id", client!.id);
  const { data } = await jobs.select("id");
  if (one) redirect(remindBack(form, data?.length ? ["stopped", "1"] : ["error", "started"]));
  redirect(data?.length ? "/app?stopped=1" : "/app?error=started");
}

// The notifications: the questions this person answers, then what others did on their
// clients in the last 14 days, newest first. Fresh: a question, or anything since the person
// last marked all read.
export async function bellItems() {
  const { supabase, membership } = await currentMember();
  if (!membership) return [];
  const seen = Date.parse((await cookies()).get("bell_seen")?.value ?? "") || 0;
  const [questions, { data: lines }, { data: people }] = await Promise.all([
    myQuestions(),
    supabase.rpc("activity_feed", { target_firm: membership.firmId, since: new Date(Date.now() - 14 * 86_400_000).toISOString(), mine: true }),
    supabase.rpc("firm_people", { target_firm: membership.firmId }),
  ]);
  // A permission request names the person who asks, and the client it is for.
  const asker = (ask: { details: unknown }) => personName(people?.find((person) => person.user_id === (ask.details as { by?: string }).by)?.email);
  return [
    ...questions.map((ask) => ({ key: ask.id, href: `/app/inbox?answer=${ask.id}`, what: `Asks to ${ask.reason_code === "time" ? "work later today" : (rightWords[ask.reason_code as Right] ?? "do something")}${ask.clients?.name ? ` for ${ask.clients.name}` : ""}`, who: asker(ask), at: null as string | null, fresh: true })),
    ...(lines ?? []).map((line, at) => ({ key: `${line.at}-${at}`, href: `/app/clients/${line.client_id}`, what: activityNames[line.action] ?? "Client changed", who: line.client_name, at: line.at as string | null, fresh: Date.parse(line.at) > seen })),
  ].slice(0, 20);
}

// Mark all read: the count starts again from now.
export async function markBellRead() {
  (await cookies()).set("bell_seen", new Date().toISOString(), { path: "/app", maxAge: 31_536_000, httpOnly: true, sameSite: "lax" });
}
