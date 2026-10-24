"use server";
import { revalidatePath } from "next/cache";
import { runJobsSoon } from "@/src/jobs/run-soon";
import { currentAdmin } from "./admin";

// Puts a failed job back in the queue and runs it now.
export async function retryJob(form: FormData) {
  const { supabase } = await currentAdmin();
  const { data } = await supabase.rpc("admin_retry_job", { job_id: Number(form.get("job")) });
  if (data) runJobsSoon();
  revalidatePath("/admin/jobs");
}

// Marks a change from the daily forms check as reviewed.
export async function reviewChange(form: FormData) {
  const { supabase } = await currentAdmin();
  await supabase.rpc("admin_review_change", { change_source: String(form.get("source")), change_at: String(form.get("at")) });
  revalidatePath("/admin");
}
