import { Badge, PageHead } from "@/app/(app)/app/ui";
import { currentStatus, stateWords, statusParts, type Part } from "@/src/lib/status";
import { systemMailReady } from "@/src/lib/system-mail";
import { emailIncident, postIncident, updateIncident } from "../actions";
import { currentAdmin, when } from "../admin";
import { Submit } from "../parts";

const tones = { working: "done", slow: "warn", down: "late", off: "" } as const;
const errors: Record<string, string> = {
  incident: "Write what is wrong in at least 3 letters and tick the parts it touches.",
  mail_off: "The outage email is not set up yet, so nothing was sent.",
};

// The public status page's incidents (PLAN.md 5.17 #43): post one, add notes as work goes on,
// email the owners of the firms it touches, and close it when it is fixed.
export default async function AdminStatus({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { supabase } = await currentAdmin();
  const [{ states }, { data: incidents, error }, { error: problem }] = await Promise.all([currentStatus(), supabase.rpc("admin_incidents"), searchParams]);
  if (error) throw new Error(`Admin incidents failed: ${error.code}`);
  const mail = systemMailReady();
  return (
    <>
      <PageHead title="Status" sub={<>What the public status page shows now. <a href="/status" target="_blank" rel="noreferrer">Open the status page</a></>} />
      {problem && errors[problem] && <p className="alert" role="alert">{errors[problem]}</p>}
      <section className="admin-card" aria-label="Parts now">
        <h2>Parts now</h2>
        {(Object.keys(statusParts) as Part[]).map((part) => (
          <div className="admin-row" key={part}>
            <strong className="grow">{statusParts[part]}</strong>
            <Badge tone={tones[states[part]]}>{stateWords[states[part]]}</Badge>
          </div>
        ))}
      </section>
      <section className="admin-card" aria-label="Post an incident">
        <h2>Post an incident</h2>
        <form action={postIncident} className="admin-row admin-form">
          <label className="grow">What is wrong, in words for firms <input name="title" required minLength={3} maxLength={200} /></label>
          <fieldset>
            <legend>Parts it touches</legend>
            {(Object.keys(statusParts) as Part[]).map((part) => (
              <label key={part} className="check"><input type="checkbox" name="parts" value={part} />{statusParts[part]}</label>
            ))}
          </fieldset>
          <label>How bad <select name="level" defaultValue="down"><option value="down">Down</option><option value="slow">Slow</option></select></label>
          <Submit>Post</Submit>
        </form>
        <p className="admin-note">
          {mail ? "Each open incident can email the owners of the firms it touches, once." : "Outage email: not set up yet. Add SYSTEM_MAIL_URL and EMAIL_FROM_DOMAIN to the server to send it. Until then nobody is emailed."}
        </p>
      </section>
      <section className="admin-card" aria-label="Incidents">
        <h2>Incidents in the last 90 days</h2>
        {incidents.length ? (
          incidents.map((incident) => (
            <div className="admin-row admin-incident" key={incident.id}>
              <div className="grow">
                <strong>{incident.title}</strong> <Badge tone={incident.ended_at ? "done" : incident.level === "down" ? "late" : "warn"}>{incident.ended_at ? "Fixed" : incident.level === "down" ? "Down" : "Slow"}</Badge>
                <span className="sub">
                  {incident.parts.map((part) => statusParts[part as Part]).join(", ")}. Started {when(incident.started_at)}{incident.ended_at && `, fixed ${when(incident.ended_at)}`}.
                  {incident.emailed ? ` Emailed ${incident.emailed === 1 ? "1 firm" : `${incident.emailed} firms`}.` : ""}
                </span>
                {((incident.updates ?? []) as { at: string; note: string }[]).map((update) => <span className="sub" key={update.at}>{when(update.at)}: {update.note}</span>)}
              </div>
              {!incident.ended_at && (
                <>
                  <form action={updateIncident} className="admin-form">
                    <input type="hidden" name="incident" value={incident.id} />
                    <label>Note <input name="note" maxLength={1000} /></label>
                    <Submit>Add note</Submit>
                    <button className="b b-secondary" name="finish" value="yes">Close as fixed</button>
                  </form>
                  {mail && !incident.emailed && (
                    <form action={emailIncident}>
                      <input type="hidden" name="incident" value={incident.id} />
                      <Submit>Email the firms</Submit>
                    </form>
                  )}
                </>
              )}
            </div>
          ))
        ) : (
          <p className="admin-empty"><strong>No incidents</strong>Nothing has gone wrong in the last 90 days.</p>
        )}
      </section>
    </>
  );
}
