import { NextResponse, type NextRequest } from "next/server";
import { apiJobStore } from "@/src/jobs/api-store";
import { handlers } from "@/src/jobs/handlers";
import { runDueJobs } from "@/src/jobs/runner";
import { isWorkerCall } from "@/src/jobs/worker-call";
import { supabaseAdmin } from "@/src/lib/supabase";

// The job worker. Supabase Cron calls it once a minute, and only while jobs are due
// (private.call_job_worker in the database). One sweep per call.
export async function POST(request: NextRequest) {
  const secret = process.env.JOB_WORKER_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (!isWorkerCall(request.headers.get("authorization"), secret))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runDueJobs(apiJobStore(supabaseAdmin()), handlers));
}
