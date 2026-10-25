import type { Metadata } from "next";
import { connection } from "next/server";
import { Badge } from "@/app/(app)/app/ui";
import { PublicPage } from "@/app/public-link";
import { currentStatus, stateWords, statusParts, summary, type Incident, type Part, type State } from "@/src/lib/status";
import "./status.css";

export const metadata: Metadata = { title: "InboxCA status", description: "Whether each part of InboxCA is working now, and past incidents." };

const tones: Record<State, "done" | "warn" | "late" | ""> = { working: "done", slow: "warn", down: "late", off: "" };
const when = (at: string) => new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

// One incident: what it touched, when it began and ended, and each note an Orelu admin added.
function IncidentCard({ incident }: { incident: Incident }) {
  return (
    <article className="status-incident">
      <h3>{incident.title}</h3>
      <p className="hint">
        {incident.parts.map((part) => statusParts[part]).join(", ")}. Started {when(incident.started_at)}
        {incident.ended_at ? `, fixed ${when(incident.ended_at)}.` : "."}
      </p>
      {!!incident.updates.length && (
        <ol>
          {incident.updates.map((update) => (
            <li key={update.at}><span className="num">{when(update.at)}</span> {update.note}</li>
          ))}
        </ol>
      )}
    </article>
  );
}

// InboxCA's public status page (PLAN.md 5.17 #43): no sign in, and nothing about any firm.
export default async function Status() {
  await connection();
  const { states, incidents } = await currentStatus();
  const open = incidents.filter((incident) => !incident.ended_at);
  const past = incidents.filter((incident) => incident.ended_at);
  return (
    <PublicPage band={<><h1>{summary(states)}</h1><p className="public-for">InboxCA status, checked {when(new Date().toISOString())} India time.</p></>}>
      <section className="public-card" aria-label="Parts of InboxCA">
        <ul className="status-parts">
          {(Object.keys(statusParts) as Part[]).map((part) => (
            <li key={part}>
              <strong>{statusParts[part]}</strong>
              <Badge tone={tones[states[part]]}>{stateWords[states[part]]}</Badge>
            </li>
          ))}
        </ul>
      </section>
      {!!open.length && (
        <section className="public-card" aria-label="Now">
          <h2>Now</h2>
          {open.map((incident) => <IncidentCard key={incident.id} incident={incident} />)}
        </section>
      )}
      <section className="public-card" aria-label="Past incidents">
        <h2>Past incidents</h2>
        {past.length ? past.map((incident) => <IncidentCard key={incident.id} incident={incident} />) : <p className="hint">No incidents in the last 90 days.</p>}
      </section>
      <p className="status-note hint">Your files always stay in your firm&apos;s own drive, and emails wait in your mailbox while InboxCA is down.</p>
    </PublicPage>
  );
}
