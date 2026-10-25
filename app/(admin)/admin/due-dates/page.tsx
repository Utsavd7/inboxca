import { Badge, PageHead } from "@/app/(app)/app/ui";
import { dueLabel } from "@/src/lib/calendar";
import { type ClientKind, clientKinds } from "@/src/lib/clients";
import { addExtension, verifyRule } from "../actions";
import { currentAdmin } from "../admin";
import { Submit } from "../parts";

const errors: Record<string, string> = {
  verify: "Give the notification's https link and the name of the CA who checked it.",
  extension: "Choose a rule, the period's last month, the new date and the notification's https link.",
};

// The due date rules and the government's extensions, those a CA has not yet checked first.
// A rule moves dates only once a CA has checked it against its official source; checking a
// rule clears the * beside its dates on every firm's calendar.
export default async function AdminDueDates({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { supabase } = await currentAdmin();
  const [{ data: rules, error }, { error: problem }] = await Promise.all([
    supabase.from("compliance_types")
      .select("code, period_key, name, source_url, verified_on, approved_by, client_kinds, due_rule")
      .order("verified_on", { nullsFirst: true }).order("code").order("period_key"),
    searchParams,
  ]);
  if (error) throw new Error(`Admin due dates failed: ${error.code}`);
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
      {!!waiting.length && (
        <section className="admin-card" aria-label="Waiting for a CA">
          <h2>Waiting for a CA</h2>
          {waiting.map((rule, at) => (
            <form action={verifyRule} className="admin-row admin-form" key={`${rule.code}${rule.period_key}`} id={`${rule.code}-${rule.period_key}`}>
              <input type="hidden" name="code" value={rule.code} />
              <input type="hidden" name="period" value={rule.period_key} />
              <div className="grow">
                <strong>{names.get(rule.code)}</strong> <span className="sub-inline num">{rule.code}</span>
                <span className="sub">
                  {rule.period_key
                    ? `Extension for ${rule.period_key} to ${dueLabel((rule.due_rule as { on: string }).on)}: moves ${reach[at]!.reduce((sum, row) => sum + row.returns, 0)} returns at ${reach[at]!.length === 1 ? "1 firm" : `${reach[at]!.length} firms`}.`
                    : "Every period. Its dates show a * until it is checked."}
                </span>
              </div>
              <label>Notification link <input name="link" type="url" pattern="https://.*" defaultValue={rule.source_url ?? ""} required /></label>
              <label>Checked by (CA) <input name="by" required minLength={2} maxLength={120} /></label>
              <Submit>Mark checked</Submit>
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
      <section className="admin-card" aria-label="Due date rules">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr><th>Rule</th><th>Applies to</th><th>Status</th><th>Checked by</th><th>Source</th></tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={`${rule.code}${rule.period_key}`}>
                  <td><strong>{rule.name ?? names.get(rule.code) ?? rule.code}</strong> <span className="sub-inline num">{rule.code}</span></td>
                  <td>{rule.period_key ? <>Extension for <span className="num">{rule.period_key}</span> to {dueLabel((rule.due_rule as { on: string }).on)}</> : `Every period${rule.client_kinds ? `, for ${rule.client_kinds.map((kind) => clientKinds[kind as ClientKind]).join(", ")}` : ""}`}</td>
                  <td>{rule.verified_on ? <Badge tone="done">Checked {dueLabel(rule.verified_on)}</Badge> : <Badge tone="warn">Not checked</Badge>}</td>
                  <td>{rule.approved_by ?? "Nobody yet"}</td>
                  <td>{rule.source_url ? <a href={rule.source_url} target="_blank" rel="noreferrer">Open the notification</a> : "None yet"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
