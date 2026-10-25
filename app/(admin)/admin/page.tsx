import Link from "next/link";
import { PageHead } from "@/app/(app)/app/ui";
import { sources } from "@/src/jobs/forms-watch";
import { addDays, dueLabel, todayInIndia } from "@/src/lib/calendar";
import { reviewChange } from "./actions";
import { currentAdmin, when } from "./admin";
import { Submit } from "./parts";

type Change = { source: string; name: string; url: string; at: string; added?: string[]; removed?: string[]; status: string };
type Alert = { source: string; name: string; url: string; at: string; reason: string };
type Watch = { sources?: Record<string, { checked?: string }>; changes?: Change[]; alerts?: Alert[] };

// The firms and open returns a change touches, in a few words.
function Touches({ reach }: { reach: { firm: string; returns: number }[] }) {
  if (!reach.length) return <span className="sub">Touches no firm&apos;s open returns.</span>;
  const returns = reach.reduce((sum, row) => sum + row.returns, 0);
  return <span className="sub" title={reach.map((row) => row.firm).join(", ")}>Touches {returns} open returns at {reach.length === 1 ? "1 firm" : `${reach.length} firms`}: {reach.slice(0, 3).map((row) => row.firm).join(", ")}{reach.length > 3 && " and more"}.</span>;
}

// Today's changes from the daily check (D42): each change to an official source waits here
// until an admin has looked at it, with the firms whose returns it touches; a source
// unreadable two days running is an alert; a due date change waits for a CA's check.
export default async function AdminToday() {
  const { supabase } = await currentAdmin();
  const [{ data, error }, { data: extensions }] = await Promise.all([
    supabase.rpc("admin_watch"),
    supabase.from("compliance_types").select("code, period_key, due_rule, source_url").neq("period_key", "").is("verified_on", null).order("code"),
  ]);
  if (error) throw new Error(`Admin watch failed: ${error.code}`);
  const watch = (data ?? {}) as Watch;
  const changes = (watch.changes ?? []).filter((change) => change.status === "draft").reverse();
  const weekAgo = addDays(todayInIndia(), -7);
  const alerts = (watch.alerts ?? []).filter((alert) => alert.at >= weekAgo).reverse();
  const checked = Object.values(watch.sources ?? {}).map((source) => source.checked ?? "").sort().at(-1) ?? null;
  const codes = new Map(sources.map((source) => [source.key, source.codes ?? []]));
  const reach = (list: string[], period?: string, movedTo?: string) => supabase.rpc("admin_reach", { codes: list, period, moved_to: movedTo }).then(({ data: rows }) => rows ?? []);
  const [changeReach, dateReach] = await Promise.all([
    Promise.all(changes.map((change) => reach(codes.get(change.source) ?? []))),
    Promise.all((extensions ?? []).map((rule) => reach([rule.code], rule.period_key, (rule.due_rule as { on: string }).on))),
  ]);
  return (
    <>
      <PageHead title="Today's changes" sub={checked ? `The daily check of official forms. ${Object.keys(watch.sources ?? {}).length} sources, last checked ${when(checked)}.` : "The daily check of official forms has not run yet."} />
      <section className="admin-card" aria-label="Changes to review">
        <h2>Changes to review</h2>
        {changes.length ? (
          changes.map((change, at) => (
            <div className="admin-row" key={`${change.source}${change.at}`}>
              <div className="grow">
                <strong>{change.name}</strong>
                <span className="sub">
                  Changed {when(change.at)}
                  {!!change.added?.length && `, ${change.added.length} files added`}
                  {!!change.removed?.length && `, ${change.removed.length} files removed`}
                </span>
                <Touches reach={changeReach[at]} />
              </div>
              <a href={change.url} target="_blank" rel="noreferrer">Open the source</a>
              <form action={reviewChange}>
                <input type="hidden" name="source" value={change.source} />
                <input type="hidden" name="at" value={change.at} />
                <Submit>Mark reviewed</Submit>
              </form>
            </div>
          ))
        ) : (
          <p className="admin-empty"><strong>Nothing to review</strong>The next check runs at 05:30 India time.</p>
        )}
      </section>
      {!!extensions?.length && (
        <section className="admin-card" aria-label="Due date changes">
          <h2>Due date changes waiting for a CA</h2>
          {extensions.map((rule, at) => (
            <div className="admin-row" key={`${rule.code}${rule.period_key}`}>
              <div className="grow">
                <strong>{rule.code} for {rule.period_key}, to {dueLabel((rule.due_rule as { on: string }).on)}</strong>
                <Touches reach={dateReach[at]} />
              </div>
              {rule.source_url && <a href={rule.source_url} target="_blank" rel="noreferrer">Open the notification</a>}
              <Link href={`/admin/due-dates#${rule.code}-${rule.period_key}`}>Check it</Link>
            </div>
          ))}
        </section>
      )}
      {!!alerts.length && (
        <section className="admin-card" aria-label="Sources not read">
          <h2>Sources not read for two days</h2>
          {alerts.map((alert) => (
            <div className="admin-row" key={`${alert.source}${alert.at}`}>
              <div className="grow">
                <strong>{alert.name}</strong>
                <span className="sub">{alert.reason}, {when(alert.at)}</span>
              </div>
              <a href={alert.url} target="_blank" rel="noreferrer">Open the source</a>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
