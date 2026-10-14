"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { log } from "@/src/lib/logger";
import { currentMember } from "@/src/lib/member";
import { invitableRoles } from "@/src/lib/roles";
import { supabaseAdmin, supabaseAnonymous } from "@/src/lib/supabase";

export type InviteState = { error?: string; done?: string };

const invitable = z.enum(invitableRoles);

// The owner adds a person with a role. A person new to InboxCA gets a sign in (no
// password, nothing to set up yet); everyone invited gets a sign in code by email and sees
// the invite once signed in.
export async function inviteMember(_prev: InviteState, form: FormData): Promise<InviteState> {
  const { supabase, membership } = await currentMember();
  if (membership?.role !== "owner") return { error: "Only the firm's owner can invite people." };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!z.email().safeParse(email).success) return { error: "Enter a valid email address." };
  const role = invitable.safeParse(form.get("role"));
  if (!role.success) return { error: "Choose a role." };

  const admin = supabaseAdmin();
  let { data: personId } = await admin.rpc("user_id_for_email", { address: email });
  if (!personId) {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) {
      log.error("invite.create_user_failed", { status: error?.status });
      return { error: "The invite could not be made. Try again in a minute." };
    }
    personId = data.user.id;
  }
  const { data: added } = await supabase.rpc("invite_member", {
    target_firm: membership.firmId,
    person: personId,
    new_role: role.data,
  });
  if (!added) return { error: `${email} is already on your firm's list.` };

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
