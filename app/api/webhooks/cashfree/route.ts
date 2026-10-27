import { NextResponse, type NextRequest } from "next/server";
import { applyEvent } from "@/src/lib/billing/billing";
import { billingProvider } from "@/src/lib/billing/provider";
import { log } from "@/src/lib/logger";
import { supabaseAdmin } from "@/src/lib/supabase";

// Cashfree's webhooks for Orelu's plan payments (PLAN.md 5.14.1, 8.10): the signature is checked
// before anything is read or written; each event is applied once, by the provider's own key for
// it, kept 7 days with the finished jobs (8.0 "webhook dedupe 7 days"); the body is never kept.
export async function POST(request: NextRequest) {
  const provider = billingProvider();
  if (!provider) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const raw = await request.text();
  if (raw.length > 200_000 || !provider.verify(raw, request.headers)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let event;
  try {
    event = provider.parse(raw, request.headers);
  } catch {
    return NextResponse.json({ error: "unreadable" }, { status: 400 });
  }
  if (!event) return NextResponse.json({ ok: true });
  const admin = supabaseAdmin();
  const key = `billing_event:${event.key}`.slice(0, 200);
  const { data: seen } = await admin.from("jobs").select("id").eq("idempotency_key", key).maybeSingle();
  if (seen) return NextResponse.json({ ok: true });
  try {
    await applyEvent(event);
  } catch (error) {
    // Cashfree sends it again later; each change is made only from the state it expects.
    log.error("billing.webhook_failed", { type: event.type, error: (error as Error).message });
    return NextResponse.json({ error: "retry" }, { status: 500 });
  }
  await admin.from("jobs").insert({ kind: "billing_event", entity_type: "event", idempotency_key: key, state: "done" });
  return NextResponse.json({ ok: true });
}
