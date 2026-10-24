import { PageHead } from "@/app/(app)/app/ui";
import { addDays, todayInIndia } from "@/src/lib/calendar";
import { reviewChange } from "./actions";
import { currentAdmin, when } from "./admin";
import { Submit } from "./parts";

type Change = { source: string; name: string; url: string; at: string; added?: string[]; removed?: string[]; status: string };
type Alert = { source: string; name: string; url: string; at: string; reason: string };
type Watch = { sources?: Record<string, { checked?: string }>; changes?: Change[]; alerts?: Alert[] };

// Today's changes from the daily forms check (D42): each change to an official source waits
// here until an admin has looked at it; a source unreadable two days running is an alert.
export default async function AdminToday() {
  const { supabase } = await currentAdmin();
  const { data, error } = await supabase.rpc("admin_watch");
  if (error) throw new Error(`Admin watch failed: ${error.code}`);
  const watch = (data ?? {}) as Watch;
  const changes = (watch.changes ?? []).filter((change) => change.status === "draft").reverse();
  const weekAgo = addDays(todayInIndia(), -7);
  const alerts = (watch.alerts ?? []).filter((alert) => alert.at >= weekAgo).reverse();
  const checked = Object.values(watch.sources ?? {}).map((source) => source.checked ?? "").sort().at(-1) ?? null;
  return (
    <>
      <PageHead title="Today's changes" sub={checked ? `The daily check of official forms. ${Object.keys(watch.sources ?? {}).length} sources, last checked ${when(checked)}.` : "The daily check of official forms has not run yet."} />
      <section className="admin-card" aria-label="Changes to review">
        <h2>Changes to review</h2>
        {changes.length ? (
          changes.map((change) => (
            <div className="admin-row" key={`${change.source}${change.at}`}>
              <div className="grow">
                <strong>{change.name}</strong>
                <span className="sub">
                  Changed {when(change.at)}
                  {!!change.added?.length && `, ${change.added.length} files added`}
                  {!!change.removed?.length && `, ${change.removed.length} files removed`}
                </span>
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
