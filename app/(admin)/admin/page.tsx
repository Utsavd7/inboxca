import Link from "next/link";
import { PageHead } from "@/app/(app)/app/ui";
import { sources } from "@/src/jobs/forms-watch";
import { addDays, dueLabel, todayInIndia } from "@/src/lib/calendar";
import { addVersion, noteUpdate, reviewChange } from "./actions";
import { currentAdmin, when } from "./admin";
import { Submit } from "./parts";

type Compared = { file: string; with?: string; same?: true; live?: true; renamed?: true; differences?: string[]; more?: number; error?: string; template?: { form_code: string; version: string } };
type Change = { source: string; name: string; url: string; at: string; added?: string[]; removed?: string[]; status: string; compared?: Compared[] };
type Alert = { source: string; name: string; url: string; at: string; reason: string };
type Update = { id: string; source: string; area: string; title: string; date?: string; link: string; seen: string; note?: { uses?: string; keeps?: string } };
type Watch = { sources?: Record<string, { checked?: string }>; changes?: Change[]; alerts?: Alert[]; items?: Update[] };
const areas: Record<string, string> = { gst: "GST", income_tax: "Income tax", tds: "TDS", company_law: "Company law" };

// A new official file beside the copy InboxCA fills today. A newer version of it with the same
// layout goes live by itself; another kept in the store is used from a period in one click; one
// with a changed layout never is.
function Comparison({ compared, change, used }: { compared: Compared; change: Change; used?: { valid_from: string | null } }) {
  if (compared.error) return <span className="sub">{compared.file}: could not compare ({compared.error}).</span>;
  const next = compared.template;
  if (compared.same && next && used) return <span className="sub">{compared.file}: same layout as {compared.with}. {compared.live ? "Went live by itself" : "In use"} as version {next.version}{used.valid_from && ` from ${dueLabel(used.valid_from)}`}.</span>;
  if (compared.same && next) return (
    <form action={addVersion} className="admin-form">
      <input type="hidden" name="source" value={change.source} />
      <input type="hidden" name="at" value={change.at} />
      <input type="hidden" name="file" value={compared.file} />
      <input type="hidden" name="form" value={next.form_code} />
      <span className="sub">{compared.file}: same layout as {compared.with}. InboxCA has kept the file, so it can be used without an app update.</span>
      {compared.renamed && <label><input type="checkbox" required /> Its name is for another year than version {compared.with}. I have checked the year it is for</label>}
      <label>Use this version from {/^ITR/.test(next.form_code) ? <input name="from" inputMode="numeric" pattern="20[0-9]{2}" placeholder="2026 for AY 2026-27" required /> : <input name="from" type="month" required />}</label>
      <Submit>Use this version</Submit>
    </form>
  );
  if (compared.same) return <span className="sub">{compared.file}: same layout as {compared.with}.</span>;
  return (
    <>
      <details className="sub">
        <summary>{compared.file}: {(compared.differences?.length ?? 0) + (compared.more ?? 0)} differences from {compared.with}</summary>
        <ul>{compared.differences?.map((line) => <li key={line}>{line}</li>)}</ul>
        {!!compared.more && <span>And {compared.more} more.</span>}
      </details>
      <span className="sub">The layout changed, so this needs mapping by Orelu before InboxCA can use it.</span>
    </>
  );
}

// The firms and open returns a change touches, in a few words.
function Touches({ reach }: { reach: { firm: string; returns: number }[] }) {
  if (!reach.length) return <span className="sub">Touches no firm&apos;s open returns.</span>;
  const returns = reach.reduce((sum, row) => sum + row.returns, 0);
  return <span className="sub" title={reach.map((row) => row.firm).join(", ")}>Touches {returns} open {returns === 1 ? "return" : "returns"} at {reach.length === 1 ? "1 firm" : `${reach.length} firms`}: {reach.slice(0, 3).map((row) => row.firm).join(", ")}{reach.length > 3 && " and more"}.</span>;
}

// Today's changes from the daily check (D42): each change to an official source waits here
// until an admin has looked at it, with the firms whose returns it touches; a source
// unreadable two days running is an alert; a due date change waits for a CA's check.
export default async function AdminToday({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { supabase } = await currentAdmin();
  const [{ data, error }, { data: extensions }, { data: templates }, { error: problem }] = await Promise.all([
    supabase.rpc("admin_watch"),
    supabase.from("compliance_types").select("code, period_key, due_rule, source_url").neq("period_key", "").is("verified_on", null).order("code"),
    supabase.from("templates").select("form_code, version, valid_from"),
    searchParams,
  ]);
  if (error) throw new Error(`Admin watch failed: ${error.code}`);
  const watch = (data ?? {}) as Watch;
  const changes = (watch.changes ?? []).filter((change) => change.status === "draft").reverse();
  const weekAgo = addDays(todayInIndia(), -7);
  const alerts = (watch.alerts ?? []).filter((alert) => alert.at >= weekAgo).reverse();
  const updates = (watch.items ?? []).filter((item) => item.seen > addDays(todayInIndia(), -14)).reverse();
  const names = new Map(sources.map((source) => [source.key, source.name]));
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
      {problem === "line" && <p className="alert" role="alert">Give either the date InboxCA uses it from or the periods it keeps the earlier version for (3 to 80 letters).</p>}
      {problem === "use" && <p className="alert" role="alert">Give a month (an assessment year for ITR) within the periods of the version it matches. A version already in the list of forms is not added again.</p>}
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
                {change.compared?.map((compared) => <Comparison key={compared.file} compared={compared} change={change} used={templates?.find((row) => row.form_code === compared.template?.form_code && row.version === compared.template?.version)} />)}
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
          <p className="admin-empty"><strong>Nothing to review</strong>The next check runs at 08:30 India time.</p>
        )}
      </section>
      <section className="admin-card" aria-label="New from the government">
        <h2>New from the government</h2>
        <p className="admin-note">Firms see each item on Today for 14 days, in the government&apos;s own words, when their clients have that work. Your one line shows with it.</p>
        {updates.length ? (
          updates.map((item) => (
            <form action={noteUpdate} className="admin-row admin-form" key={item.id}>
              <input type="hidden" name="item" value={item.id} />
              <div className="grow">
                <strong>{item.title}</strong>
                <span className="sub">{areas[item.area]}. {names.get(item.source)}, {item.date ? dueLabel(item.date) : `seen on ${dueLabel(item.seen)}`}.{item.note?.uses && ` InboxCA uses this from ${dueLabel(item.note.uses)}.`}{item.note?.keeps && ` InboxCA keeps the earlier version for ${item.note.keeps}.`}</span>
                <a href={item.link} target="_blank" rel="noreferrer">Open the source</a>
              </div>
              <label>InboxCA uses this from <input name="uses" type="date" /></label>
              <label>Or keeps the earlier version for <input name="keeps" maxLength={80} placeholder="returns up to Mar 2026" /></label>
              <Submit>Save the line</Submit>
            </form>
          ))
        ) : (
          <p className="admin-empty"><strong>Nothing new in 14 days</strong>New items from the official pages show here.</p>
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
      <section className="admin-card" aria-label="Pages InboxCA cannot read">
        <h2>Pages InboxCA cannot read</h2>
        {sources.filter((source) => source.kind === "manual").map((source) => (
          <div className="admin-row" key={source.key}>
            <div className="grow">
              <strong>{source.name}</strong>
              <span className="sub">{areas[source.area]}. Could not check this page: the site blocks InboxCA or shows nothing without its own app. Look at it yourself.</span>
            </div>
            <a href={source.url} target="_blank" rel="noreferrer">Open the page</a>
          </div>
        ))}
      </section>
    </>
  );
}
