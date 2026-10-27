import { cache } from "react";
import { addDays, periodLabel, todayInIndia } from "@/src/lib/calendar";
import { periodName } from "@/src/lib/documents";
import { downloadUse } from "@/src/lib/download-use";
import { whenRange } from "@/src/lib/mail-view";
import { currentMember, myQuestions } from "@/src/lib/member";
import { formName, preparedSchema } from "@/src/lib/prepared";
import { answersWorkItems } from "@/src/lib/work/answers";
import { formsWorkItems } from "@/src/lib/work/forms";
import { governmentUpdates, governmentWorkItems } from "@/src/lib/work/government";
import { gstMatchWorkItems } from "@/src/lib/work/gst-match";
import { inboxWeek, inboxWorkItems } from "@/src/lib/work/inbox";
import { inboxTeamWorkItems } from "@/src/lib/work/inbox-team";
import { itrCheckWorkItems } from "@/src/lib/work/itr-check";
import { papersWorkItems } from "@/src/lib/work/papers";
import { isLead, rankWork, visibleTo, type Area, type Listed } from "@/src/lib/work/today";
import { firmAccounts } from "./shell-data";

// What Today and the full list (/app/work) read for the signed in person, as the row rules
// allow: the lines at the top, every area's work items in one list, and the week's numbers.
type Signed = Awaited<ReturnType<typeof currentMember>>;
type Context = { supabase: Signed["supabase"]; membership: NonNullable<Signed["membership"]>; userId: string };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const DAY = 86_400_000;

// At most two lines above the list, most pressing first: the firm's email or drive not working,
// setup still to do (the owner), then what is new from the government. The government update
// that does not fit joins the list instead.
export type Line = "mail" | "drive" | "setup" | "gov";
export const attention = cache(async ({ supabase, membership }: Context) => {
  const owner = membership.role === "owner";
  const firm = membership.firmId;
  const count = (query: PromiseLike<{ count: number | null }>) => Promise.resolve(query).then((result) => result.count ?? 0);
  const [accounts, driveAway, gov, counts] = await Promise.all([
    firmAccounts(),
    isLead(membership.role) ? count(supabase.from("requests").select("id", { count: "exact", head: true }).eq("kind", "alert").eq("reason_code", "drive_away").eq("status", "pending")) : 0,
    governmentUpdates(supabase, firm).then(({ items }) => items.some((item) => !item.dismissed), () => false),
    owner
      ? Promise.all([
          count(supabase.from("clients").select("id", { count: "exact", head: true }).eq("firm_id", firm).is("archived_at", null)),
          count(supabase.from("client_registrations").select("id", { count: "exact", head: true }).filter("services", "neq", "{}")),
          count(supabase.from("firm_members").select("user_id", { count: "exact", head: true })),
        ])
      : null,
  ]);
  const has = (kind: string) => accounts.some((account) => account.kind === kind);
  const setup = counts && [
    { done: has("mail"), href: "/app/settings#mailbox", action: "Connect the firm's email" },
    { done: has("drive"), href: "/app/settings#drive", action: "Connect the firm's drive" },
    { done: !!counts[0], href: "/app/clients", action: "Add your clients" },
    { done: !!counts[1], href: "/app/clients", action: "Tick the services for each client" },
    { done: counts[2] > 1, href: "/app/people", action: "Invite your team" },
  ];
  const steps = setup?.some((step) => !step.done) ? { done: setup.filter((step) => step.done).length, total: setup.length, next: setup.find((step) => !step.done)! } : null;
  const wanted: [Line, boolean][] = [["mail", owner && accounts.find((account) => account.kind === "mail")?.status === "needs_reconnect"], ["drive", !!driveAway], ["setup", !!steps], ["gov", gov]];
  return { lines: wanted.filter(([, on]) => on).map(([line]) => line).slice(0, 2), setup: steps, owner };
});

// What the daily drive and sign in checks found, for the owner and partners: what to do and
// why. The drive being out of reach is a line above the list instead.
type AlertDetails = { free_bytes?: number; files?: number; client?: string; email?: string; count?: number; name?: string; day?: string };
const driveSettings = { label: "Open drive settings", href: "/app/settings?group=email#drive" };
function alertItem(alert: { id: string; entity_id: string; client_id: string | null; reason_code: string | null; details: unknown }): Omit<Listed, "key" | "audience" | "area"> {
  const details = alert.details as AlertDetails;
  const client = alert.client_id && details.client ? { client: { id: alert.client_id, name: details.client } } : {};
  switch (alert.reason_code) {
    case "drive_shared": return { title: "Stop sharing InboxCA's folder", why: "It is shared with someone, or has a link. Only you should reach it", action: driveSettings };
    case "drive_full": return { title: "Free some space in your drive", why: `${((details.free_bytes ?? 0) / 1024 ** 2).toFixed(0)} MB left, so new client files may not be saved`, action: driveSettings };
    case "renames": return { title: `Check what ${details.email} renamed`, why: `Renamed ${details.count} files today. Each file's history has the changes`, action: { label: "See papers", href: "/app/documents" } };
    case "captures": return { title: `Ask ${details.email} about screen captures`, why: `Tried to capture a paper's screen ${details.count} times today. Each try is logged`, action: { label: "See people", href: "/app/people" } };
    case "parallel": return { title: `Ask whether ${details.email}'s login is shared`, why: `Signed in on another PC ${details.count} times today, which ends the other session each time`, action: { label: "See people", href: "/app/people" } };
    case "owner_pcs": return { title: `Your login was used on ${details.count} computers at once`, why: "Within one hour today. Each person in your firm needs their own login", action: { label: "Invite people", href: "/app/people" } };
    case "request_stalled": return { ...client, title: `Call ${details.client}`, why: "Three reminders went, and the papers asked for are still missing", action: { label: "See papers", href: `/app/papers/${alert.entity_id}` } };
    case "drive_missing": return { title: "Find the papers missing from your drive", why: `${details.files} ${details.files === 1 ? "paper is" : "papers are"} missing from your drive`, action: { label: "See missing papers", href: "/app/documents?year=all&show=missing" } };
    case "virus": return { title: `${details.name} had a virus`, why: "Nobody can open it in InboxCA. It is in the Files with a virus folder of your drive", urgent: true, action: { label: "Got it", href: "" } };
    default: return { title: "Look at your drive", why: "Something in your drive needs a look", action: driveSettings };
  }
}

// Every work item for this person, most urgent first. Late clients are read up to late at a
// time (Today needs 7, the full list more); total counts them all.
export async function workFor(ctx: Context, late: number) {
  const { supabase, membership } = ctx;
  const today = todayInIndia();
  const firm = membership.firmId;
  const owner = membership.role === "owner";
  const lead = isLead(membership.role);
  const dayStart = new Date(`${today}T00:00:00+05:30`).toISOString();
  const tag = (area: Area) => (items: Omit<Listed, "area">[]) => items.map((item): Listed => ({ ...item, area }));

  // Prepared returns whose acknowledgement arrived, to mark filed; only the latest version of
  // each counts. Drafts to approve and files to file come with the returns (forms.ts).
  const confirmations = Promise.all([
    Promise.resolve(supabase.from("documents").select("id, client_id, period_key, status, prepared, clients(name)").eq("firm_id", firm).not("prepared", "is", null).order("received_at", { ascending: false }).limit(100)),
    Promise.resolve(supabase.from("requests").select("entity_id").eq("firm_id", firm).eq("kind", "form_confirmation").eq("status", "pending").limit(100)),
  ]).then(([forms, confirming]) => {
    const seen = new Set<string>();
    const waiting = new Set(confirming.data?.map((item) => item.entity_id));
    return (forms.data ?? []).flatMap((file): Listed[] => {
      const meta = preparedSchema.parse(file.prepared);
      const group = [file.client_id, file.period_key, meta.form, meta.registration].join(":");
      if (seen.has(group)) return [];
      seen.add(group);
      if (file.status === "deleted" || !waiting.has(file.id) || !membership.may("mark_filed", file.client_id)) return [];
      const name = file.clients?.name ?? "";
      return [{ key: `confirm:${file.id}`, title: `${formName(meta.form)} for ${name}, ${periodName(file.period_key ?? "")}`, why: "The acknowledgement arrived. Check it and mark the return filed", client: { id: file.client_id, name }, action: { label: meta.status === "draft" ? "Review and approve" : "Mark filed", href: `/app/clients/${file.client_id}?tab=outputs` }, audience: "assigned", area: "returns" }];
    });
  });

  // Late clients, one row each with the oldest late return: the person's own unless they lead.
  const rules = Promise.resolve(supabase.from("compliance_types").select("code, name, frequency").eq("period_key", "")).then(({ data }) => new Map(data?.map((rule) => [rule.code, rule])));
  const lateRows = Promise.all([Promise.resolve(supabase.rpc("late_clients", { target_firm: firm, mine: !lead }, { count: "exact" }).limit(late)), rules]).then(([{ data, count }, rule]) => ({
    count: count ?? data?.length ?? 0,
    items: (data ?? []).map((row): Listed => {
      const days = Math.round((Date.parse(today) - Date.parse(row.due_on)) / DAY);
      const name = `${rule.get(row.code)?.name ?? row.code ?? ""} for ${periodLabel(rule.get(row.code)?.frequency ?? null, row.period_key)}`;
      return { key: `late:${row.client_id}`, title: `File ${name}`, why: `${plural(days, "day", "days")} late${row.returns > 1 ? `, and ${plural(row.returns - 1, "more late return", "more late returns")}` : ""}`, client: { id: row.client_id, name: row.client_name }, due: row.due_on, urgent: true, action: { label: "See returns", href: `/app/clients/${row.client_id}?tab=due` }, audience: "assigned", area: "returns" };
    }),
  }));

  // What only the owner or partners act on, and a notice's date close by. A client asked three
  // times shows once, as the call for whoever looks after it.
  const papers = papersWorkItems(ctx);
  const firmItems = Promise.all([
    myQuestions(),
    owner ? Promise.resolve(supabase.from("devices").select("id").eq("firm_id", firm).eq("status", "waiting")) : null,
    Promise.resolve(supabase.rpc("notice_alerts", { target_firm: firm }).limit(10)),
    lead ? Promise.resolve(supabase.from("requests").select("id, entity_id, client_id, reason_code, details").eq("kind", "alert").neq("entity_type", "papers_in").neq("entity_type", "owner_device").neq("reason_code", "drive_away").eq("status", "pending").limit(20)) : null,
    papers,
    owner ? downloadUse(firm).catch(() => null) : null,
  ]).then(async ([asks, devices, notices, alerts, calls, use]): Promise<Listed[]> => {
    const waitingIds = devices?.data?.map((device) => device.id) ?? [];
    const { count: seenToday } = waitingIds.length
      ? await supabase.from("activity_log").select("entity_id", { count: "exact", head: true }).eq("firm_id", firm).eq("action", "device.first_seen").in("entity_id", waitingIds).gte("at", dayStart)
      : { count: 0 };
    return tag("firm")([
      ...(asks.length ? [{ key: "questions", title: `Answer ${plural(asks.length, "permission request", "permission requests")}`, why: "Someone in your team is waiting for your yes or no", action: { label: "Answer", href: "/app/inbox" }, audience: "approver" as const }] : []),
      // This month's downloads through InboxCA are used up and wait for the owner's OK (D26).
      ...(use && use.used >= use.most ? [{ key: "downloads", title: "Allow more downloads", why: "This month's downloads through InboxCA are used up, so they are paused", action: { label: "Allow more", href: "/app/settings?group=data#caps" }, audience: "firm" as const }] : []),
      ...(waitingIds.length ? [{ key: "pcs", title: `Approve ${plural(waitingIds.length, "PC", "PCs")}`, why: seenToday === waitingIds.length ? "Signed in from your office today" : "Waiting for your approval before staff can use them", action: { label: "Approve", href: "/app/settings#office" }, audience: "firm" as const }] : []),
      ...(notices.data ?? []).map((notice) => ({
        key: `notice:${notice.id}`,
        title: `Review the notice for ${notice.client_name}`,
        why: `Its ${notice.action_date ? "action date" : "review deadline"} ${notice.due_on < today ? "has passed" : notice.due_on === today ? "is today" : "is within 3 days"}`,
        client: { id: notice.client_id, name: notice.client_name },
        due: notice.due_on,
        urgent: notice.due_on <= today,
        action: { label: "Review notice", href: `/app/notices?notice=${notice.id}` },
        audience: "assigned" as const,
      })),
      ...(alerts?.data ?? [])
        // Missing papers, files with a virus and the owner's own login on several computers are the
        // owner's to sort out; a person's day of renames, captures or second sign ins only that day.
        .filter((alert) => (owner || !["drive_missing", "virus", "owner_pcs"].includes(alert.reason_code ?? "")) && !alert.reason_code?.startsWith("office_") && (!["captures", "parallel", "renames", "owner_pcs"].includes(alert.reason_code ?? "") || (alert.details as AlertDetails).day === today))
        .filter((alert) => alert.reason_code !== "request_stalled" || !calls.some((item) => item.key === `call:${alert.entity_id}`))
        .map((alert) => ({ ...alertItem(alert), key: `${alert.reason_code === "virus" ? "virus" : "alert"}:${alert.id}`, audience: "firm" as const })),
    ]);
  });

  const items = (
    await Promise.all([
      papers.then(tag("papers")),
      formsWorkItems(ctx).then(tag("returns")),
      itrCheckWorkItems(ctx).then(tag("returns"), () => []),
      gstMatchWorkItems(ctx).then(tag("returns"), () => []),
      // An email waiting for a person is on the Today of the person it is given to, and late ones
      // on the owner's and partners' (inbox-team.ts). Front desk also gets the emails that name no
      // client, as picking the client is theirs.
      inboxWorkItems(ctx).then((list) => list.flatMap((item): Listed[] => (!item.key.startsWith("reply:") ? [{ ...item, area: "papers" }] : membership.role === "front_desk" && !item.client ? [{ ...item, area: "emails" }] : []))),
      inboxTeamWorkItems(ctx).then(tag("emails")),
      answersWorkItems(ctx).then(tag("emails"), () => []),
      attention(ctx).then(({ lines }) => (lines.includes("gov") ? [] : governmentWorkItems(ctx).then(tag("gov"), () => []))),
      lateRows.then(({ items }) => items),
      confirmations,
      firmItems,
    ])
  ).flat();
  // One row an email, the one given to a person when there are two.
  const unique = [...new Map(items.map((item) => [item.key, item])).values()];
  const { count: lateCount, items: lateList } = await lateRows;
  // Someone who does not lead sees the clients they look after.
  const theirs = lead ? [] : [...new Set(unique.flatMap((item) => (item.audience === "assigned" && item.client ? [item.client.id] : [])))];
  const looked = lead ? null : new Set(theirs.length ? ((await supabase.rpc("looked_after", { target_firm: firm, clients: theirs })).data ?? []) : []);
  const shown = rankWork(unique.filter((item) => visibleTo(item, { role: membership.role, looked })), today);
  return { items: shown, total: shown.length + Math.max(0, lateCount - lateList.length), late: lateCount };
}

// This week's numbers for the person's role, each opening its list.
export async function weekFor(ctx: Context, work: ReturnType<typeof workFor>) {
  const { supabase, membership } = ctx;
  const today = todayInIndia();
  const monday = whenRange("week", today).from!.slice(0, 10);
  const lead = isLead(membership.role);
  const monthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const [range, mail, load, people] = await Promise.all([
    Promise.resolve(supabase.rpc("work_numbers", lead ? { target_firm: membership.firmId, since: `${today.slice(0, 8)}01`, until: monthEnd } : { target_firm: membership.firmId, since: monday, until: addDays(monday, 6), mine: true })).then(({ data }) => data?.[0] ?? { due: 0, filed: 0, waiting: 0 }),
    membership.role === "manager" ? null : inboxWeek(ctx),
    // null when it could not be read, so Today says so rather than "no returns".
    membership.role === "manager" ? Promise.resolve(supabase.rpc("team_load", { target_firm: membership.firmId, until: addDays(monday, 6) })).then(({ data, error }) => (error ? null : (data ?? []))) : [],
    membership.role === "manager" ? Promise.resolve(supabase.rpc("firm_people", { target_firm: membership.firmId })).then(({ data }) => new Map(data?.map((person) => [person.user_id, person.email]))) : new Map<string, string>(),
  ]);
  const { items, late } = await work;
  return {
    range,
    mail,
    late,
    approve: items.filter((item) => item.area === "returns" && item.key.startsWith("approve:")).length,
    stuck: items.filter((item) => item.key.startsWith("call:") || (item.area === "returns" && item.urgent && !!item.due && item.due >= today)).length,
    busiest: load?.map((row) => ({ id: row.user_id, email: people.get(row.user_id) ?? "", returns: row.returns })) ?? null,
  };
}
