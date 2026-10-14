"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canManageClients, clientKinds } from "@/src/lib/clients";
import { serverCrypto } from "@/src/lib/crypto";
import { DAYS, type Hours, type SpecialHours } from "@/src/lib/hours";
import { cleanNumber, isGstin, isPan, panOfGstin } from "@/src/lib/identifiers";
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

// Adds a client with its PAN and GSTIN, encrypted with the firm's key. A GSTIN holds the
// PAN, so the PAN can be left empty when a GSTIN is given.
export async function addClient(_prev: ClientState, form: FormData): Promise<ClientState> {
  const { supabase, membership } = await currentMember();
  const values = Object.fromEntries(["name", "kind", "pan", "gstin"].map((field) => [field, String(form.get(field) ?? "")]));
  const fail = (error: string) => ({ error, values });
  if (!membership || !canManageClients(membership.role)) return fail("Only the owner, a partner or a manager can add clients.");
  const name = String(form.get("name") ?? "").trim();
  const kind = String(form.get("kind") ?? "");
  const gstin = cleanNumber(String(form.get("gstin") ?? ""));
  const pan = cleanNumber(String(form.get("pan") ?? "")) || (gstin && panOfGstin(gstin));
  if (!name || name.length > 200) return fail("Enter the client's name.");
  if (!(kind in clientKinds)) return fail("Choose what kind of client this is.");
  if (gstin && !isGstin(gstin)) return fail("That GSTIN is not valid. Check it for a typing mistake.");
  if (pan && !isPan(pan)) return fail("That PAN is not valid. A PAN is 5 letters, 4 digits and a letter.");
  if (gstin && panOfGstin(gstin) !== pan) return fail("The PAN does not match the one inside the GSTIN.");

  const id = randomUUID();
  const firm = membership.firmId;
  const crypto = serverCrypto();
  const numbers = [
    ["pan", pan, null],
    ["gstin", gstin, gstin.slice(0, 2)],
  ].filter(([, number]) => number) as [string, string, string | null][];
  const registrations = await Promise.all(
    numbers.map(async ([type, number, state_code]) => ({
      kind: type,
      number_enc: await crypto.encrypt(firm, `clients/${id}/${type}`, number),
      number_bidx: await crypto.blindIndex(firm, type, number),
      state_code,
    })),
  );
  const { data, error } = await supabase.rpc("add_client", {
    target_firm: firm,
    client: id,
    client_name: name,
    client_kind: kind,
    registrations,
  });
  if (error?.code === "23505") return fail("A client with this PAN or GSTIN is already in your firm.");
  if (error || !data) return fail("The client could not be added. Try again.");
  redirect(`/app/clients/${id}`);
}
