"use server";
import { revalidatePath } from "next/cache";
import { downloadUse } from "@/src/lib/download-use";
import { currentMember } from "@/src/lib/member";
import { supabaseAdmin } from "@/src/lib/supabase";

// The owner's OK once 80% of this month's downloads are used (PLAN.md 5.14): another month's
// downloads, logged; the meter reads it back from the log.
export async function allowDownloads() {
  const { userId, membership } = await currentMember();
  if (membership?.role !== "owner") return;
  const use = await downloadUse(membership.firmId);
  if (use.used < 0.8 * use.most) return;
  const { error } = await supabaseAdmin().from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "usage.downloads_allowed", entity_type: "firm", entity_id: membership.firmId, details: { month: use.month } });
  if (error) throw new Error(`Allowing downloads failed: ${error.code}`);
  revalidatePath("/app/settings");
}
