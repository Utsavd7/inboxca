import { FileCheck2, FileClock } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { askedByPhone, checkFigures, remindClient, stopSend } from "@/app/(app)/actions";
import { dueLabel, todayInIndia } from "@/src/lib/calendar";
import type { DocumentRequest } from "@/src/lib/checklists";
import { canManageClients } from "@/src/lib/clients";
import { periodName } from "@/src/lib/documents";
import { currentMember } from "@/src/lib/member";
import { supabaseAdmin } from "@/src/lib/supabase";
import { Pending } from "../../pending";
import { Badge, Card, PageHead, Row, Toast } from "../../ui";

const notes: Record<string, string> = {
  reminded: "This client was already emailed today. Each client gets at most one email a day, so the next one can go tomorrow.",
  send: "The reminder could not start. Try again.",
  started: "The reminder had already started, so it could not be stopped.",
};
const times = (count: number) => (count === 1 ? "once" : count === 2 ? "twice" : `${count} times`);

// One request for papers (user, 26 Oct 2026), opened from a paper item on Today: what the client
// was asked for, what is in, and how often they were asked, with the next step. While papers are
// missing: Send reminder now (Undo stops it in time), or Mark as asked by phone after a call.
// Once every paper is in: Check the figures. For those who manage clients and those who look
// after this one; everyone else who sees the client only reads it.
export default async function Papers({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { data: request } = await supabase.from("requests").select("id, client_id, status, expires_at, details, clients(name, email_enc, reminders_paused)").eq("firm_id", membership.firmId).eq("kind", "documents").eq("id", id).maybeSingle();
  if (!request?.client_id || !request.clients) notFound();
  const details = request.details as unknown as DocumentRequest;
  const client = request.clients;
  const today = todayInIndia();
  const [{ data: looks }, { data: open }, { data: rules }, { data: mailbox }, { count: emailed }] = await Promise.all([
    canManageClients(membership.role) ? Promise.resolve({ data: true }) : supabase.rpc("looks_after", { target_firm: membership.firmId, client: request.client_id }),
    supabase.from("requests").select("id").eq("kind", "alert").eq("entity_type", "papers_in").eq("entity_id", id).eq("status", "pending").maybeSingle(),
    details.returns?.length ? supabase.from("compliance_types").select("code, name").eq("period_key", "").in("code", details.returns) : Promise.resolve({ data: [] }),
    supabase.from("connected_accounts").select("status").eq("firm_id", membership.firmId).eq("kind", "mail").maybeSingle(),
    supabaseAdmin().from("activity_log").select("at", { count: "exact", head: true }).eq("firm_id", membership.firmId).eq("entity_id", request.client_id).eq("action", "reminder.sent").gte("at", `${today}T00:00:00+05:30`),
  ]);
  const acts = !!looks && !membership.viewOnlyUntil;
  const missing = details.items.filter((item) => !item.received.length);
  const asked = details.followups?.length ?? 0;
  const live = request.status === "pending" && Date.parse(request.expires_at ?? "") > new Date().getTime();
  const what = details.returns?.length ? details.returns.map((code) => rules?.find((rule) => rule.code === code)?.name ?? code).join(" and ") : "";
  // Anything that stops an email going now.
  const stop = mailbox?.status !== "connected" ? "Connect the firm's email in Settings first. Reminders go from the firm's own address." : !client.email_enc ? "This client has no email address. Add one on the client's page." : client.reminders_paused ? "Reminders are paused for this client. Resume them on the client's page." : emailed ? "Already emailed today. The next reminder can go tomorrow." : "";
  const hidden = (
    <>
      <input type="hidden" name="client" value={request.client_id} />
      <input type="hidden" name="request" value={request.id} />
      <input type="hidden" name="from" value="papers" />
    </>
  );

  return (
    <div className="papers">
      <PageHead
        crumbs={[["/app", "Today"], [`/app/clients/${request.client_id}?tab=documents`, client.name]]}
        title="Papers asked for"
        sub={
          <p className="hint">
            {what || "Papers"}{details.period ? ` for ${periodName(details.period)}` : ""}.{" "}
            {missing.length ? `${details.items.length - missing.length} of ${details.items.length} in.` : "Every paper is in."}{" "}
            {asked ? `Reminded ${times(asked)}, last on ${dueLabel(details.followups!.at(-1)!)}.` : ""}
            {details.chased && details.chased >= (details.followups?.at(-1) ?? "") ? ` Asked by phone on ${dueLabel(details.chased)}.` : ""}
          </p>
        }
        actions={
          acts && (
            <>
              {live && missing.length > 0 && (
                <>
                  <form action={askedByPhone}>
                    {hidden}
                    <Pending className="b b-secondary" busy="Saving">Mark as asked by phone</Pending>
                  </form>
                  <form action={remindClient}>
                    {hidden}
                    <Pending className="b b-primary" busy="Sending" disabled={!!stop}>Send reminder now</Pending>
                  </form>
                </>
              )}
              {open && (
                <form action={checkFigures}>
                  {hidden}
                  <Pending className="b b-primary">Check the figures</Pending>
                </form>
              )}
            </>
          )
        }
      />
      {acts && live && missing.length > 0 && stop && <p className="hint" role="note">{stop}</p>}
      {query.error && notes[query.error] && <p className="alert" role="alert">{notes[query.error]}</p>}
      <Card id="papers-asked" title="Papers" Icon={missing.length ? FileClock : FileCheck2} kind={missing.length ? "papers" : "done"} count={details.items.length}>
        <ul className="app-rows">
          {details.items.map((item) => (
            <Row
              key={item.type}
              title={item.type}
              meta={item.received.length ? `${item.received.length === 1 ? "1 file" : `${item.received.length} files`} received` : live ? "Not received yet" : "Not received"}
              status={<Badge tone={item.received.length ? "done" : "warn"}>{item.received.length ? "In" : "Missing"}</Badge>}
            />
          ))}
        </ul>
        <p className="app-card-foot hint">
          {live ? `The client's upload link works until ${dueLabel(request.expires_at!.slice(0, 10))}.` : request.status === "done" ? "Every paper is in, so the reminders have stopped." : "The upload link has ended. Ask for papers again from the client's page."}{" "}
          <Link href={`/app/clients/${request.client_id}?tab=documents`}>Open {client.name}</Link>
        </p>
      </Card>
      {query.reminding && query.job && (
        <Toast
          undo={
            <form action={stopSend}>
              {hidden}
              <input type="hidden" name="job" value={query.job} />
              <Pending className="b" busy="Stopping">Undo</Pending>
            </form>
          }
        >
          The reminder goes out in a minute from your firm&apos;s email.
        </Toast>
      )}
      {query.phoned && <Toast>Marked as asked by phone. The next reminder email waits 3 days.</Toast>}
      {query.stopped && <Toast>Stopped. Nothing was sent.</Toast>}
    </div>
  );
}
