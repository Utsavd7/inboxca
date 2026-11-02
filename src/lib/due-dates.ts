import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/db/types";

// A due date counts as checked for a firm when Orelu's CA checked the rule against its
// notification (compliance_types.verified_on, /admin/due-dates) or the firm's owner confirmed
// it against the rule's official link, for that firm only (firm_due_dates, Settings →
// Reminders). Orelu's check wins; the owner's fills in until it comes. Client reminders, the
// asks for papers and the "what is due" answer all read the rules through here.
export async function firmChecked<Rule extends { code: string; verified_on: string | null }>(db: SupabaseClient<Database>, firm: string, rules: Rule[] | null | undefined) {
  const { data } = await db.from("firm_due_dates").select("code, confirmed_at").eq("firm_id", firm);
  const mine = new Map(data?.map((row) => [row.code, row.confirmed_at.slice(0, 10)]));
  return (rules ?? []).map((rule) => (rule.verified_on || !mine.has(rule.code) ? rule : { ...rule, verified_on: mine.get(rule.code)! }));
}

// Settings → Reminders, for the owner: every rule the firm's services use that Orelu has not
// checked, with its official link (when the rule has one), the firm's next return on it, and
// who confirmed it for the firm, when. A rule without a link cannot be confirmed with one click.
export async function dueDatesForOwner(db: SupabaseClient<Database>, firm: string, today: string) {
  const [{ data: rules }, { data: registrations }, { data: mine }, { data: people }] = await Promise.all([
    db.from("compliance_types").select("code, name, frequency, source_url").eq("period_key", "").is("verified_on", null).order("name"),
    db.from("client_registrations").select("services").eq("firm_id", firm).filter("services", "neq", "{}").limit(5000),
    db.from("firm_due_dates").select("code, confirmed_by, confirmed_at, source_url").eq("firm_id", firm),
    db.rpc("firm_people", { target_firm: firm }),
  ]);
  const used = new Set(registrations?.flatMap((registration) => registration.services));
  const shown = (rules ?? []).filter((rule) => used.has(rule.code));
  const { data: coming } = shown.length ? await db.from("tasks").select("code, period_key, due_on").eq("firm_id", firm).eq("kind", "compliance").neq("status", "filed").gte("due_on", today).in("code", shown.map((rule) => rule.code)).order("due_on").limit(500) : { data: null };
  return shown.map((rule) => {
    const confirmed = mine?.find((row) => row.code === rule.code);
    return { ...rule, next: coming?.find((task) => task.code === rule.code) ?? null, confirmed: confirmed ? { ...confirmed, email: people?.find((person) => person.user_id === confirmed.confirmed_by)?.email } : null };
  });
}
