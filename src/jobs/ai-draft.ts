import { aiReady } from "@/src/lib/ai";
import { writeReply } from "@/src/lib/ai-reply";
import { serverCrypto } from "@/src/lib/crypto";
import { supabaseAdmin } from "@/src/lib/supabase";
import { answerEvent, answerTo } from "./answer-mail";
import type { Handler } from "./runner";

// Emails AI leaves to a person without trying (PLAN.md 5.11, the intent allowlist): a notice
// that asks what to do is for the CA, and a sender who may not see the client's records, or
// who writes for several clients, gets nothing from them.
const LEFT = ["notice_question", "not_allowed", "answer_not_allowed", "client_unclear"];
// A draft goes once its email is this old (the ai_drafts migration purges it).
export const DRAFT_DAYS = 7;

// A draft by AI for an email waiting in Needs reply ("Inbox, answered" G), queued when the email
// starts waiting (the ai_drafts migration). Written from the client's records by the
// assistant's read-only tools, checked, sealed with the firm's key and kept on the email's
// request for a person to read, change and send: AI never sends. It goes when the email is
// answered or marked done, or once the email is 7 days old. Off until an AI key is set.
export const aiDraft: Handler = async (job) => {
  if (!aiReady()) return { done: true };
  const admin = supabaseAdmin();
  const { data: ask, error } = await admin.from("requests").select("id, firm_id, client_id, entity_id, reason_code, status, draft_enc, firms(name)").eq("id", job.entity_id ?? "").eq("kind", "team_reply").eq("entity_type", "email").maybeSingle();
  if (error) return { retry: "request_not_read" };
  if (!ask?.client_id || !ask.firms || ask.status !== "pending" || ask.draft_enc || LEFT.includes(ask.reason_code ?? "")) return { done: true };
  const { data: event } = await admin.from("email_events").select(`${answerEvent}, received_at`).eq("firm_id", ask.firm_id).eq("id", ask.entity_id).maybeSingle();
  if (!event || Date.parse(event.received_at) < Date.now() - DRAFT_DAYS * 86_400_000) return { done: true };
  const left = async (reason: string) => {
    await admin.from("activity_log").insert({ firm_id: ask.firm_id, action: "email.ai_left", entity_type: "email", entity_id: ask.entity_id, details: { reason } });
    return { done: true as const, reason };
  };
  if (!(await answerTo(admin, event))) return left("not_allowed");
  const result = await writeReply(admin, ask.firm_id, ask.firms.name, ask.entity_id, "auto_draft");
  if (!result) return { retry: "mail_not_read" };
  if (result.outcome !== "draft") return left(result.reason);
  const sealed = await serverCrypto().encrypt(ask.firm_id, `requests/${ask.id}/draft`, JSON.stringify({ text: result.text, papers: result.papers }));
  const { error: saveError } = await admin.from("requests").update({ draft_enc: sealed }).eq("id", ask.id).eq("status", "pending").is("draft_enc", null);
  if (saveError) return { retry: "draft_not_saved" };
  await admin.from("activity_log").insert({ firm_id: ask.firm_id, action: "email.ai_drafted", entity_type: "email", entity_id: ask.entity_id, details: {} });
  return { done: true };
};
