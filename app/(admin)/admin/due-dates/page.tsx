import { Badge, PageHead } from "@/app/(app)/app/ui";
import type { Dates } from "@/src/jobs/date-watch";
import { sources } from "@/src/jobs/forms-watch";
import { dueLabel, periodLabel } from "@/src/lib/calendar";
import { type ClientKind, clientKinds } from "@/src/lib/clients";
import { addExtension, undoExtension, verifyRule } from "../actions";
import { currentAdmin, when } from "../admin";
import { Submit } from "../parts";

const errors: Record<string, string> = {
  verify: "Give the notification's https link and the name of the CA who checked it.",
  extension: "Choose a rule, the period's last month, the new date and the notification's https link.",
  undo: "Choose the extension to undo.",
};
const listings = new Map(sources.map((source) => [source.key, source.name]));

// One click puts the period's returns back on the rule's date.
function Undo({ code, period }: { code: string; period: string }) {
  return (
    <form action={undoExtension} className="admin-form">
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="period" value={period} />
      <Submit confirm="Every firm's returns for this period go back to the rule's own date.">Undo</Submit>
    </form>
  );
}
const moved = (reach: { returns: number }[]) => {
  const returns = reach.reduce((sum, row) => sum + row.returns, 0);
  return returns === 1 ? "1 return" : `${returns} returns`;
};

// The due date rules and the government's extensions, those a CA has not yet checked first.
// A rule moves dates only once a CA has checked it against its official source; checking a
// rule clears the * beside its dates on every firm's calendar.
export default async function AdminDueDates({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { supabase } = await currentAdmin();
  const [{ data: rules, error }, { error: problem }, { data: dates }] = await Promise.all([
    supabase.from("compliance_types")
      .select("code, period_key, name, source_url, verified_on, approved_by, client_kinds, due_rule")
      .order("verified_on", { nullsFirst: true }).order("code").order("period_key"),
    searchParams,
    supabase.rpc("admin_dates"),
  ]);
  if (error) throw new Error(`Admin due dates failed: ${error.code}`);
  const week = (dates ?? {}) as Partial<Dates>;
  const automatic = new Set(rules.filter((rule) => rule.period_key && (rule.due_rule as { notice?: string }).notice).map((rule) => `${rule.code}:${rule.period_key}`));
  const names = new Map(rules.filter((rule) => !rule.period_key).map((rule) => [rule.code, rule.name ?? rule.code]));
  const waiting = rules.filter((rule) => !rule.verified_on);
  // What each waiting extension would move: its period's returns not yet filed and not on the new date.
  const reach = await Promise.all(waiting.map((rule) => rule.period_key
    ? supabase.rpc("admin_reach", { codes: [rule.code], period: rule.period_key, moved_to: (rule.due_rule as { on: string }).on }).then(({ data }) => data ?? [])
    : Promise.resolve(null)));
  return (
    <>
      <PageHead title="Due dates" sub={`${waiting.length} of ${rules.length} rules wait for a CA to check them against the official notification.`} />
      {problem && errors[problem] && <p className="alert" role="alert">{errors[problem]}</p>}
      <section className="admin-card" aria-label="This week's official notices">
        <h2>This week&apos;s official notices</h2>
        <p className="sub">{week.checked ? `Checked ${when(week.checked)}. Every Sunday InboxCA reads the week's notices on the official listings; a plain extension of a return it knows moves that period's date for every firm at once, and anything less waits for you here.` : "The Sunday check has not run yet."}</p>
        {week.week?.length ? week.week.map((did) => (
          <div className="admin-row" key={`${did.id}${did.code ?? ""}`}>
            <div className="grow">
              <strong>{did.title}</strong>
              <span className="sub">{listings.get(did.source) ?? did.source}{did.date && `, ${dueLabel(did.date)}`}. {did.why}</span>
            </div>
            {did.did === "extended" ? (automatic.has(`${did.code}:${did.period}`) ? <Badge tone="done">Moved</Badge> : <Badge plain>Undone</Badge>) : did.did === "ask" ? <Badge tone="warn">For you to decide</Badge> : <Badge plain>Nothing to do</Badge>}
            <a href={did.link} target="_blank" rel="noreferrer">Open</a>
            {did.did === "extended" && did.code && did.period && automatic.has(`${did.code}:${did.period}`) && <Undo code={did.code} period={did.period} />}
          </div>
        )) : week.checked && <p className="sub">Nothing new this week.</p>}
      </section>
      {!!waiting.length && (
        <section className="admin-card" aria-label="Waiting for a CA">
          <h2>Waiting for a CA</h2>
          <p className="admin-note">Firms see a * beside these dates until a CA checks the rule against its notification.</p>
          {waiting.map((rule, at) => (
            <form action={verifyRule} className="admin-row admin-form" key={`${rule.code}${rule.period_key}`} id={`${rule.code}-${rule.period_key}`}>
              <input type="hidden" name="code" value={rule.code} />
              <input type="hidden" name="period" value={rule.period_key} />
              <div className="grow">
                <strong>{names.get(rule.code)}</strong>
                <span className="sub">
                  {rule.period_key
                    ? `Extension for ${periodLabel(null, rule.period_key)} to ${dueLabel((rule.due_rule as { on: string }).on)}: moves ${moved(reach[at]!)} at ${reach[at]!.length === 1 ? "1 firm" : `${reach[at]!.length} firms`}.`
                    : "Every period"}
                </span>
              </div>
              <label>Notification link <input name="link" type="url" pattern="https://.*" defaultValue={rule.source_url ?? ""} required /></label>
              <label>Checked by (CA) <input name="by" required minLength={2} maxLength={120} /></label>
              <Submit confirm={rule.period_key ? `Moves ${moved(reach[at]!)} to ${dueLabel((rule.due_rule as { on: string }).on)} now.` : "Its dates lose the * on every firm's calendar, and reminders use them."}>Mark checked</Submit>
            </form>
          ))}
        </section>
      )}
      <section className="admin-card" aria-label="Record an extension">
        <h2>Record a government extension</h2>
        <form action={addExtension} className="admin-row admin-form">
          <label>Return <select name="code" required>{[...names].map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
          <label>Period, its last month <input name="period" type="month" required /></label>
          <label>New due date <input name="on" type="date" required /></label>
          <label className="grow">Notification link <input name="link" type="url" pattern="https://.*" required /></label>
          <Submit>Save for a CA to check</Submit>
        </form>
      </section>
      {rules.some((rule) => rule.verified_on) && <section className="admin-card" aria-label="Checked rules">
        <h2>Checked rules</h2>
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr><th>Rule</th><th>Applies to</th><th>Checked</th><th>By</th><th>Source</th></tr>
            </thead>
            <tbody>
              {rules.filter((rule) => rule.verified_on).map((rule) => (
                <tr key={`${rule.code}${rule.period_key}`}>
                  <td><strong>{rule.name ?? names.get(rule.code) ?? rule.code}</strong></td>
                  <td className="wrap">{rule.period_key ? <>Extension for {periodLabel(null, rule.period_key)} to {dueLabel((rule.due_rule as { on: string }).on)}</> : `Every period${rule.client_kinds ? `, for ${rule.client_kinds.map((kind) => clientKinds[kind as ClientKind]).join(", ")}` : ""}`}</td>
                  <td className="num">{dueLabel(rule.verified_on!)}</td>
                  <td>{rule.approved_by}{automatic.has(`${rule.code}:${rule.period_key}`) && <Undo code={rule.code} period={rule.period_key} />}</td>
                  <td>{rule.source_url ? <a href={rule.source_url} target="_blank" rel="noreferrer">{(rule.due_rule as { notice?: string }).notice ?? "Open the notification"}</a> : "None yet"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>}
    </>
  );
}
