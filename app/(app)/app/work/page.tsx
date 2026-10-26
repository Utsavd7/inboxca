import { ListChecks } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { manageClient, manageTasks, sendNow, stopSend } from "@/app/(app)/actions";
import { canManageClients } from "@/src/lib/clients";
import { dueLabel, periodLabel, todayInIndia } from "@/src/lib/calendar";
import type { DocumentRequest } from "@/src/lib/checklists";
import { currentMember } from "@/src/lib/member";
import { MAX_FOLLOW_UPS } from "@/src/lib/reminders";
import { inFilter, isLead, workFilters, type Listed, type WorkFilter } from "@/src/lib/work/today";
import { LinkTabs } from "../link-tabs";
import { MarkFiled } from "../mark-filed";
import { Presence } from "../motion";
import { Pending } from "../pending";
import { workFor } from "../work-data";
import { WorkRows } from "../work-rows";
import { Avatar, Badge, Card, Empty, PageHead, Row, SidePanel, Toast } from "../ui";
import "../work.css";

type Params = { show?: string; page?: string; panel?: string; client?: string; confirm?: string; sending?: string; job?: string; stopped?: string; assigned?: string; marked?: string; t?: string; error?: string };
type Db = Awaited<ReturnType<typeof currentMember>>["supabase"];
const PAGE = 25;
// Late clients read at once; the Calendar lists every late return beyond them.
const LATE = 500;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const errors: Record<string, string> = {
  assign: "That client could not be assigned to you. Try again from the client's page.",
  send: "The send could not start. Try again.",
  started: "The send had already started, so it could not be stopped.",
};

// The person's whole list, the one Today shows the first 7 of: the same items for the same
// person, filtered and a page at a time. Late returns have Mark filed and Assign to me here,
// and the owner and partners remind every late client, or every client still missing papers,
// after a preview.
export default async function Work({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { supabase, userId, membership } = await currentMember();
  if (!membership) redirect("/app");
  const show = (params.show && params.show in workFilters ? params.show : "all") as WorkFilter;
  const today = todayInIndia();
  const firm = membership.firmId;
  const sends = isLead(membership.role) && !membership.viewOnlyUntil;
  const { data: me } = await supabase.from("firm_members").select("team_id").eq("firm_id", firm).eq("user_id", userId).single();
  const [{ items, total, late }, { data: assigned }] = await Promise.all([
    workFor({ supabase, membership, userId }, LATE),
    supabase.from("client_assignments").select("client_id").eq("firm_id", firm).or(`user_id.eq.${userId}${me?.team_id ? `,team_id.eq.${me.team_id}` : ""}`).limit(5000),
  ]);
  const mine = new Set(assigned?.map((row) => row.client_id));
  // All, Late and Returns count every late client, as Today does, beyond the ones listed here.
  const unlisted = total - items.length;
  const counts = Object.fromEntries((Object.keys(workFilters) as WorkFilter[]).map((key) => [key, items.filter((item) => inFilter(item, key, today, mine)).length + (key === "all" || key === "late" || key === "returns" ? unlisted : 0)])) as Record<WorkFilter, number>;
  const listed = items.filter((item) => inFilter(item, show, today, mine));
  const pages = Math.max(1, Math.ceil(listed.length / PAGE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1));
  const shown = listed.slice((page - 1) * PAGE, page * PAGE);
  const href = (next: { show?: WorkFilter; page?: number; extra?: string }) => {
    const search = new URLSearchParams();
    const pill = next.show ?? show;
    if (pill !== "all") search.set("show", pill);
    if (next.page && next.page > 1) search.set("page", String(next.page));
    return `/app/work${search.size ? `?${search}` : ""}${next.extra ? `${search.size ? "&" : "?"}${next.extra}` : ""}`;
  };
  const back = href({ page });

  // Late clients on this page nobody looks after, for Assign to me.
  const lateIds = shown.flatMap((item) => (item.key.startsWith("late:") && item.client ? [item.client.id] : []));
  const { data: looked } = lateIds.length && canManageClients(membership.role) ? await supabase.from("client_assignments").select("client_id").in("client_id", lateIds) : { data: [] };
  const lookedAfter = new Set(looked?.map((row) => row.client_id));
  const assignAs = membership.role === "manager" ? "manager" : "partner_in_charge";
  const write = !membership.viewOnlyUntil;
  const more = (item: Listed) => {
    if (!item.key.startsWith("late:") || !item.client || !write) return null;
    const client = item.client;
    return (
      <>
        {membership.may("mark_filed", client.id) && (
          <Link className="b b-ghost" href={href({ page, extra: `panel=filed&client=${client.id}` })} scroll={false} aria-label={`Mark filed for ${client.name}`}>
            Mark filed
          </Link>
        )}
        {canManageClients(membership.role) && !lookedAfter.has(client.id) && (
          <form action={manageClient}>
            <input type="hidden" name="from" value="work" />
            <input type="hidden" name="client" value={client.id} />
            <input type="hidden" name="intent" value="assign" />
            <input type="hidden" name="role" value={assignAs} />
            <input type="hidden" name="who" value={`person:${userId}`} />
            <Pending className="b b-ghost" busy="Assigning" aria-label={`Assign ${client.name} to me`}>
              Assign to me
            </Pending>
          </form>
        )}
      </>
    );
  };

  const [marking, preview] = await Promise.all([
    params.panel === "filed" && params.client && /^[0-9a-f-]{36}$/.test(params.client) && write ? marked(supabase, params.client, today) : null,
    sends && (params.confirm === "late" || params.confirm === "papers") ? sendPreview(supabase, firm, params.confirm) : null,
  ]);
  const markedCount = params.t?.split(".").filter(Boolean).length ?? 0;

  return (
    <>
      <PageHead
        title="Your list"
        crumbs={[["/app", "Today"]]}
        sub="Everything that needs you, most urgent first."
        actions={
          sends && show === "late" && late ? (
            <Link className="b b-secondary" href={href({ extra: "confirm=late" })} scroll={false}>
              Remind all late clients
            </Link>
          ) : sends && show === "papers" ? (
            <Link className="b b-secondary" href={href({ extra: "confirm=papers" })} scroll={false}>
              Remind about missing papers
            </Link>
          ) : null
        }
      />
      {params.assigned && <Toast>Assigned to you. The client is now on your list.</Toast>}
      {params.stopped && <Toast>Stopped. Nothing was sent.</Toast>}
      {params.sending && params.job && (
        <Toast
          undo={
            <form action={stopSend}>
              <input type="hidden" name="job" value={params.job} />
              <Pending className="b" busy="Stopping">
                Undo
              </Pending>
            </form>
          }
        >
          Reminders go out in a minute from your firm&apos;s email.
        </Toast>
      )}
      {params.marked && markedCount > 0 && (
        <Toast
          undo={
            params.marked === "filed" && (
              <form action={manageTasks}>
                <input type="hidden" name="from" value="work" />
                {params.t!.split(".").map((id) => <input key={id} type="hidden" name="task" value={id} />)}
                <Pending className="b" name="intent" value="reopen" busy="Undoing">
                  Undo
                </Pending>
              </form>
            )
          }
        >
          {plural(markedCount, "return", "returns")} marked {params.marked === "filed" ? "filed" : params.marked === "in_progress" ? "in progress" : "not filed"}.
        </Toast>
      )}
      {params.error && errors[params.error] && (
        <p className="alert" role="alert">
          {errors[params.error]}
        </p>
      )}

      <div className="work-bar">
        <LinkTabs kind="pills" label="Show" items={(Object.keys(workFilters) as WorkFilter[]).map((key) => ({ href: href({ show: key }), label: workFilters[key], count: counts[key], current: show === key }))} />
      </div>
      <Card id="w-list" title={workFilters[show] === "All" ? "Everything" : workFilters[show]} Icon={ListChecks} kind="approve" count={counts[show]} countTone="blue">
        {shown.length ? (
          <WorkRows name="work" items={shown} today={today} membership={membership} more={more} />
        ) : (
          <Empty Icon={ListChecks} kind="done" title={show === "all" ? "Nothing needs you" : "Nothing here"}>
            <span>{show === "all" ? "You are all caught up. New work for your clients shows here first." : "Nothing of this kind waits for you."}</span>
          </Empty>
        )}
      </Card>
      {(show === "all" || show === "late" || show === "returns") && !!unlisted && (
        <p className="hint">
          The {LATE} clients late the longest are here. <Link href="/app/calendar?view=overdue">The Calendar lists every late return.</Link>
        </p>
      )}
      <nav className="pager" aria-label="List pages">
        <p>{listed.length ? `Showing ${((page - 1) * PAGE + 1).toLocaleString("en-IN")} to ${Math.min(page * PAGE, listed.length).toLocaleString("en-IN")} of ${listed.length.toLocaleString("en-IN")}` : ""}</p>
        <span>
          {page > 1 && (
            <Link className="b b-secondary" href={href({ page: page - 1 })}>
              Previous
            </Link>
          )}
          {page < pages && (
            <Link className="b b-secondary" href={href({ page: page + 1 })}>
              Next
            </Link>
          )}
        </span>
      </nav>

      <Presence>
        {marking && (
          <SidePanel key="filed" id="mark-filed" title={marking.length > 1 ? `Mark ${marking.length} returns filed` : "Mark filed"} close={back}>
            {marking.length ? <MarkFiled state={<input type="hidden" name="from" value="work" />} rows={marking} /> : <p className="hint">This client has no late return now.</p>}
          </SidePanel>
        )}
        {preview && (
          <SidePanel key="send" id="send-title" title={preview.title} close={back}>
            <p className="hint">{preview.hint}</p>
            {!preview.mailbox && (
              <p className="alert" role="alert">
                Connect the firm&apos;s email in Settings first. Reminders go from the firm&apos;s own address.
              </p>
            )}
            <ul className="app-rows work-preview">
              {preview.rows.map((row) => (
                <Row key={row.key} lead={<Avatar name={row.name} />} title={row.name} meta={row.what} status={row.skip ? <Badge plain>{row.skip}</Badge> : <Badge tone="blue">Will be emailed</Badge>} />
              ))}
            </ul>
            <form action={sendNow} className="mark-filed-actions work-send">
              <input type="hidden" name="what" value={params.confirm} />
              <Pending className="b b-primary" busy="Sending" disabled={!preview.mailbox || !preview.count}>
                {preview.button}
              </Pending>
              <Link className="b b-secondary" href={back} scroll={false}>
                Cancel
              </Link>
            </form>
          </SidePanel>
        )}
      </Presence>
    </>
  );
}

// A late client's late returns, for Mark filed.
async function marked(supabase: Db, client: string, today: string) {
  const [{ data: rows }, { data: rules }] = await Promise.all([
    supabase.from("tasks").select("id, code, period_key, due_on, clients(name)").eq("client_id", client).eq("kind", "compliance").neq("status", "filed").lt("due_on", today).order("due_on").limit(100),
    supabase.from("compliance_types").select("code, name, frequency").eq("period_key", ""),
  ]);
  const rule = new Map(rules?.map((row) => [row.code, row]));
  return (rows ?? []).map((task) => ({ id: task.id, name: task.clients?.name ?? "", sub: `${rule.get(task.code ?? "")?.name ?? task.code ?? ""} for ${periodLabel(rule.get(task.code ?? "")?.frequency ?? null, task.period_key)}, due ${dueLabel(task.due_on)}` }));
}

// Who gets what when every late client, or every client still missing papers, is reminded at
// once, for the preview before Send. The job decides the rest the same way (src/jobs/reminders.ts).
async function sendPreview(supabase: Db, firm: string, what: "late" | "papers") {
  const skipFor = (client: { email_enc: string | null; reminders_paused: boolean } | null) => (!client ? "Not emailed" : client.reminders_paused ? "Reminders paused" : !client.email_enc ? "No email address" : null);
  const [{ data: mailbox }, list] = await Promise.all([
    supabase.from("connected_accounts").select("status").eq("firm_id", firm).eq("kind", "mail").maybeSingle(),
    what === "late"
      ? supabase.rpc("late_clients", { target_firm: firm }).limit(200).then(async ({ data: late }) => {
          const ids = late?.map((row) => row.client_id) ?? [];
          const { data: people } = ids.length ? await supabase.from("clients").select("id, email_enc, reminders_paused").in("id", ids) : { data: [] };
          const byId = new Map(people?.map((person) => [person.id, person]));
          return (late ?? []).map((row) => ({ key: row.client_id, name: row.client_name, what: `${plural(row.returns, "late return", "late returns")}, the oldest due ${dueLabel(row.due_on)}`, skip: skipFor(byId.get(row.client_id) ?? null) }));
        })
      : supabase.from("requests").select("id, details, clients(name, email_enc, reminders_paused)").eq("kind", "documents").eq("status", "pending").gt("expires_at", new Date().toISOString()).limit(200).then(({ data: asks }) =>
          (asks ?? []).flatMap((ask) => {
            const details = ask.details as unknown as DocumentRequest;
            const missing = (details.items ?? []).filter((item) => !item.received.length).map((item) => item.type);
            if (!missing.length) return [];
            const asked = details.followups?.length ?? 0;
            return [{ key: ask.id, name: ask.clients?.name ?? "", what: missing.join(", "), skip: asked >= MAX_FOLLOW_UPS ? `Reminded ${asked} times` : skipFor(ask.clients) }];
          }),
        ),
  ]);
  const count = list.filter((row) => !row.skip).length;
  return {
    rows: list,
    count,
    mailbox: mailbox?.status === "connected",
    title: what === "late" ? `Remind ${plural(list.length, "late client", "late clients")}` : "Remind about missing papers",
    hint:
      what === "late"
        ? "Each client gets one email from your firm's address listing their late returns. Anyone already reminded today, who already sent papers for that period, or whose email your team is answering is skipped."
        : "Each client gets one email from your firm's address listing the papers still missing, with their upload link. Anyone already reminded today is skipped.",
    button: `Send ${plural(count, "reminder", "reminders")}`,
  };
}
