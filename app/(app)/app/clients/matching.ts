import { todayInIndia } from "@/src/lib/calendar";
import { serverCrypto } from "@/src/lib/crypto";
import { cleanNumber, isGstin, isPan } from "@/src/lib/identifiers";
import type { currentMember } from "@/src/lib/member";
import { pages } from "@/src/lib/paged";

// The client list's filter, shared by the list page and by Set services and Assign for every
// client it matches, so both read the same clients as the signed in person (row level security).
type Db = Awaited<ReturnType<typeof currentMember>>["supabase"];
export const pills = { all: "All", late: "Late", missing: "Missing papers", mine: "Assigned to me" } as const;
export type Pill = keyof typeof pills;
export type Filter = { q: string; group?: string; branch?: string; tag: string; archived: boolean; show: Pill };
export type Lateness = "late" | "on" | null;
export const columns = "id, name, tags, client_registrations(kind, number_enc), client_assignments(user_id, team_id, role), next:tasks(code, period_key, due_on), asks:requests(id), late:tasks(id)";
// What each pill adds: a client counts when it has at least one such row (late returns are
// joined by every list, to count them, and by a count that asks for them).
const pillJoin: Record<Pill, string> = { all: "", late: "", missing: ", missing:requests!inner(id)", mine: ", mine:client_assignments!inner(role)" };
// Every client matching at most this many at once; a longer list is narrowed first.
export const MOST_MATCHING = 2000;
export const filterKeys = ["q", "group", "branch", "tag", "archived", "show"] as const;

// The filter as the list page's query string carries it.
export function readFilter(params: Record<string, string | undefined>): Filter {
  return { q: params.q?.trim() ?? "", group: params.group || undefined, branch: params.branch || undefined, tag: params.tag?.trim().slice(0, 40) ?? "", archived: params.archived === "1", show: params.show && params.show in pills ? (params.show as Pill) : "all" };
}

// A whole email, PAN or GSTIN is found by its blind index, never searched in plain text.
export async function filterContext(supabase: Db, firm: string, userId: string, filter: Filter) {
  const crypto = serverCrypto(), number = cleanNumber(filter.q), kind = isGstin(number) ? "gstin" : isPan(number) ? "pan" : null;
  const [emailIndex, numberIndex] = await Promise.all([filter.q.includes("@") ? crypto.blindIndex(firm, "email", filter.q) : null, kind ? crypto.blindIndex(firm, kind, number) : null]);
  const [{ data: byNumber }, { data: me }] = await Promise.all([
    kind && numberIndex ? supabase.from("client_registrations").select("client_id").eq("firm_id", firm).eq("kind", kind).eq("number_bidx", numberIndex) : Promise.resolve({ data: null }),
    supabase.from("firm_members").select("team_id").eq("firm_id", firm).eq("user_id", userId).maybeSingle(),
  ]);
  return { emailIndex, byNumber, userId, myTeam: me?.team_id ?? null };
}
export type FilterContext = Awaited<ReturnType<typeof filterContext>>;

// The same search, group, branch and archive choice for the list and every pill's count.
export function clientsIn(supabase: Db, firm: string, filter: Filter, ctx: FilterContext, pill: Pill, select: string, head = false, only: Lateness = null) {
  const today = todayInIndia(), now = new Date().toISOString();
  const lateness = only ?? (pill === "late" ? "late" : null);
  let query = supabase.from("clients").select(`${select}${pillJoin[pill]}${head && lateness ? ", late:tasks(id)" : ""}` as typeof columns, { count: "exact", head }).eq("firm_id", firm);
  if (filter.group) query = query.eq("group_id", filter.group);
  if (filter.branch) query = query.eq("branch_id", filter.branch);
  if (filter.tag) query = query.contains("tags", [filter.tag]);
  query = filter.archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (ctx.emailIndex) query = query.eq("email_bidx", ctx.emailIndex);
  else if (ctx.byNumber) query = query.in("id", ctx.byNumber.map((row) => row.client_id));
  else if (filter.q) query = query.ilike("name", `%${filter.q.replace(/[\\%_]/g, "\\$&")}%`);
  if (!head || lateness) query = query.eq("late.kind", "compliance").neq("late.status", "filed").lt("late.due_on", today);
  if (head && lateness) query = query.limit(1, { referencedTable: "late" });
  if (lateness) query = lateness === "late" ? query.not("late", "is", null) : query.is("late", null);
  if (pill === "missing") query = query.eq("missing.kind", "documents").eq("missing.status", "pending").gt("missing.expires_at", now).limit(1, { referencedTable: "missing" });
  if (pill === "mine") query = query.or(`user_id.eq.${ctx.userId}${ctx.myTeam ? `,team_id.eq.${ctx.myTeam}` : ""}`, { referencedTable: "mine" });
  return query;
}

// Every current client the filter matches, up to MOST_MATCHING plus one so the caller knows when
// there are more; 1,000 a read.
export async function matchingClients(supabase: Db, firm: string, userId: string, filter: Filter) {
  if (filter.archived) return [];
  const ctx = await filterContext(supabase, firm, userId, filter);
  const rows: { id: string }[] = [];
  await pages<{ id: string }>(async (from) => {
    if (from > MOST_MATCHING) return { data: [], error: null };
    // The list's late join is filtered on every read, so it is selected here too.
    const read = await clientsIn(supabase, firm, filter, ctx, filter.show, "id, late:tasks(id)").order("id").range(from, from + 999);
    rows.push(...((read.data ?? []) as { id: string }[]));
    return read;
  });
  return rows.map((row) => row.id).slice(0, MOST_MATCHING + 1);
}

// Up to size ids at a time, for reads whose ids travel in the request.
export const chunks = <T>(list: T[], size = 200) => Array.from({ length: Math.ceil(list.length / size) }, (_, at) => list.slice(at * size, at * size + size));
