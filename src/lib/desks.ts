import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/db/types";
import { canManageClients } from "./clients";
import { personName } from "./roles";

// A client's desks (20261113100000_take_work.sql): who does its GST and its income tax work, for
// years, until changed. A desk's person is the client's staff assignment for that work; one for
// all work (work null) holds every desk. A client with both kinds of returns, or whose people
// already split them, has the two desks; any other has one desk for all its work.
export type DeskWork = "gst" | "income_tax" | null;
export const deskNames = { gst: "GST", income_tax: "Income tax" } as const;
export type Holder = { id: string; team: boolean; name: string };
export type Desk = { work: DeskWork; holder: Holder | null };
type Assignment = { user_id: string | null; team_id: string | null; role: string; work?: string | null };

// public.work_of: the desk a return code is for (GSTR, CMP and PMT are GST; ITR and ADV income tax).
export const workOf = (code: string | null) => (/^(GSTR|CMP|PMT)/.test(code ?? "") ? "gst" : /^(ITR|ADV)/.test(code ?? "") ? "income_tax" : null);

export function desksOf(assignments: Assignment[], codes: string[], name: (a: Assignment) => string): Desk[] {
  const staff = assignments.filter((a) => a.role === "staff");
  const works = (["gst", "income_tax"] as const).filter((work) => codes.some((code) => workOf(code) === work) || staff.some((a) => a.work === work));
  const holder = (a?: Assignment): Holder | null => (a ? { id: (a.team_id ?? a.user_id)!, team: !!a.team_id, name: name(a) } : null);
  if (works.length < 2 && !staff.some((a) => a.work)) return [{ work: null, holder: holder(staff[0]) }];
  return works.map((work) => ({ work, holder: holder(staff.find((a) => !a.work || a.work === work)) }));
}

// Who may do what with a chip: give any desk to anyone, or take and hand back their own.
export const deskViewer = (membership: { role: string; viewOnlyUntil?: string }, userId: string) =>
  ({ id: userId, assign: !membership.viewOnlyUntil && canManageClients(membership.role), take: !membership.viewOnlyUntil && membership.role !== "front_desk" });

// The desk a return is on, when the client has one for it.
export const deskFor = (desks: Desk[], code: string | null) => desks.find((desk) => desk.work === null || desk.work === workOf(code));

// The desks of some clients and the names of the firm's people, for pages that list them.
export async function readDesks(supabase: SupabaseClient<Database>, firm: string, clients: string[]) {
  const ids = [...new Set(clients)].slice(0, 200);
  const [{ data: rows }, { data: numbers }, { data: people }, { data: teams }] = await Promise.all([
    ids.length ? supabase.from("client_assignments").select("client_id, user_id, team_id, role, work").eq("firm_id", firm).in("client_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("client_registrations").select("client_id, services").in("client_id", ids) : Promise.resolve({ data: [] }),
    supabase.rpc("firm_people", { target_firm: firm }),
    supabase.from("groups").select("id, name").eq("firm_id", firm).eq("kind", "team"),
  ]);
  const name = (a: Assignment) => (a.team_id ? teams?.find((team) => team.id === a.team_id)?.name : personName(people?.find((person) => person.user_id === a.user_id)?.email)) ?? "";
  const desks = new Map(ids.map((id) => [id, desksOf((rows ?? []).filter((row) => row.client_id === id), (numbers ?? []).filter((row) => row.client_id === id).flatMap((row) => row.services), name)]));
  const personOf = (id: string | null): Holder | null => (id ? { id, team: false, name: personName(people?.find((person) => person.user_id === id)?.email) } : null);
  return { desks, personOf };
}
