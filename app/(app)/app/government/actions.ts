"use server";
import { revalidatePath } from "next/cache";
import { currentMember } from "@/src/lib/member";

// Dismiss on a government item: gone for this person on every device, still in the full list.
export async function dismissGovUpdate(form: FormData) {
  const { supabase, membership } = await currentMember();
  if (!membership) return;
  const { error } = await supabase.rpc("dismiss_gov_update", { target_firm: membership.firmId, item: String(form.get("item") ?? "") });
  if (error) throw new Error(`Dismissing failed: ${error.code}`);
  revalidatePath("/app", "layout");
}
