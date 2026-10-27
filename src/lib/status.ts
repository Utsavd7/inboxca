import { supabaseAnonymous } from "./supabase";

// The public status page (PLAN.md 5.17 #43): each part of InboxCA as working, slow or down,
// from cheap checks and the jobs table, made worse by any open incident an Orelu admin posted.
export const statusParts = { app: "The app", mail: "Reading firm email", files: "Reading and checking files", reminders: "Reminders" } as const;
export type Part = keyof typeof statusParts;
export type State = "working" | "slow" | "down" | "off";
export type Incident = { id: string; title: string; parts: Part[]; level: "slow" | "down"; updates: { at: string; note: string }[]; started_at: string; ended_at: string | null };

export const stateWords: Record<State, string> = { working: "Working", slow: "Slow", down: "Down", off: "Not set up yet" };
const rank: Record<State, number> = { off: 0, working: 1, slow: 2, down: 3 };
const worse = (a: State, b: State) => (rank[a] >= rank[b] ? a : b);

// Work waiting past its time: 10 minutes is slow, an hour is down.
export const lateState = (seconds = 0): State => (seconds >= 3600 ? "down" : seconds >= 600 ? "slow" : "working");

// A check that answers within 2 seconds is working, slower is slow, none at all is down.
export const timedState = (ok: boolean, ms: number): State => (!ok ? "down" : ms > 2000 ? "slow" : "working");

// The file worker's own health check, or off when no file worker is set up.
async function workerState(fetcher: typeof fetch = fetch): Promise<State> {
  const url = process.env.FILE_WORKER_URL;
  if (!url) return "off";
  const started = Date.now();
  const ok = await fetcher(`${url.replace(/\/$/, "")}/health`, { cache: "no-store", signal: AbortSignal.timeout(5000) }).then((response) => response.ok, () => false);
  return timedState(ok, Date.now() - started);
}

// Each part's state: the worse of what was measured and what an open incident says.
export function partStates(measured: Record<Part, State>, incidents: Incident[]) {
  const states = { ...measured };
  for (const incident of incidents.filter((item) => !item.ended_at))
    for (const part of incident.parts) states[part] = worse(states[part], incident.level);
  return states;
}

// One line for the whole page.
export function summary(states: Record<Part, State>) {
  const all = Object.values(states);
  return all.includes("down") ? "Some parts of InboxCA are down" : all.includes("slow") ? "Some parts of InboxCA are slow" : "Everything is working";
}

// Measured now, as nobody: the database's answer and its time judge the app, the oldest due
// work judges mail reading and reminders, and the file worker adds its own health check. With
// no database answer nothing works, so every part is down.
export async function currentStatus() {
  const started = Date.now();
  const [{ data, error }, worker] = await Promise.all([supabaseAnonymous().rpc("service_status"), workerState()]);
  const app = timedState(!error, Date.now() - started);
  const { late = {}, incidents = [] } = (error ? {} : data ?? {}) as { late?: Partial<Record<Part, number>>; incidents?: Incident[] };
  const measured: Record<Part, State> = error
    ? { app, mail: "down", files: "down", reminders: "down" }
    : { app, mail: lateState(late.mail), files: worker === "off" ? "off" : worse(worker, lateState(late.files)), reminders: lateState(late.reminders) };
  return { states: partStates(measured, incidents), incidents };
}
