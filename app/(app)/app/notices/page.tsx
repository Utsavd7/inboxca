import { FileWarning, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { manageNotice } from "@/app/(app)/actions";
import { dueLabel, todayInIndia } from "@/src/lib/calendar";
import { currentMember } from "@/src/lib/member";
import { authorities, noticeStatuses, type NoticeDetails } from "@/src/lib/notices";
import { AutoSelect } from "../auto-select";
import { Avatar, Badge, Empty, PageHead } from "../ui";

const catalog = ["Intimation u/s 143(1)", "Notice u/s 143(2)", "Notice u/s 142(1)", "Notice u/s 148", "Demand notice u/s 156", "DRC-01", "ASMT-10", "Registration notice", "Show cause notice", "Summons"];

// Notices the firm's clients received (PLAN.md 5.6), the nearest date first. A date the rules
// found is only a suggestion until a person confirms it against the notice; until then the
// firm's own review deadline shows, never as the legal one.
export default async function Notices({ searchParams }: { searchParams: Promise<{ add?: string; error?: string }> }) {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const { add, error } = await searchParams;
  const [{ data: open }, { data: done }, { data: clients }] = await Promise.all([
    supabase.from("tasks").select("id, client_id, due_on, status, details, clients(name)").eq("kind", "notice").in("status", ["upcoming", "in_progress"]).order("due_on").limit(200),
    supabase.from("tasks").select("id, client_id, due_on, status, details, clients(name)").eq("kind", "notice").in("status", ["replied", "closed"]).order("due_on", { ascending: false }).limit(20),
    supabase.from("clients").select("id, name").is("archived_at", null).order("name"),
  ]);
  const today = todayInIndia();

  const row = (notice: NonNullable<typeof open>[number]) => {
    const details = notice.details as unknown as NoticeDetails;
    return (
      <tr key={notice.id}>
        <td>
          <span className="who">
            <Avatar name={notice.clients?.name ?? ""} />
            <Link className="row-link" href={`/app/clients/${notice.client_id}`}>
              {notice.clients?.name}
            </Link>
          </span>
        </td>
        <td>
          {details.notice_type}
          <span className="sub">{[authorities[details.authority] ?? details.authority, details.reference].filter(Boolean).join(", ")}</span>
        </td>
        <td className="shrink hint">{dueLabel(details.received_on)}</td>
        <td className="shrink">
          {details.action_date ? (
            <span className={notice.due_on < today && notice.status !== "closed" && notice.status !== "replied" ? "when late" : undefined}>{dueLabel(details.action_date)}</span>
          ) : (
            <form action={manageNotice} className="cell-form">
              <input type="hidden" name="notice" value={notice.id} />
              <Badge tone="warn">Review by {dueLabel(notice.due_on)}</Badge>
              <input type="date" name="date" defaultValue={details.suggested_date} aria-label={`Action date for ${notice.clients?.name}`} className="cell-input" />
              <button className="b b-secondary b-small" name="intent" value="confirm">
                Confirm date
              </button>
            </form>
          )}
        </td>
        <td className="shrink">
          <form action={manageNotice}>
            <input type="hidden" name="notice" value={notice.id} />
            <AutoSelect save="status" name="intent" defaultValue={notice.status} aria-label={`Status of the notice for ${notice.clients?.name}`}>
              {Object.entries(noticeStatuses).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </AutoSelect>
            <button hidden value="status" />
          </form>
        </td>
      </tr>
    );
  };
  const table = (rows: NonNullable<typeof open>) => (
    <div className="table-wrap">
      <table className="t">
        <thead>
          <tr>
            <th scope="col">Client</th>
            <th scope="col">Notice</th>
            <th scope="col">Received</th>
            <th scope="col">Action date</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>{rows.map(row)}</tbody>
      </table>
    </div>
  );

  return (
    <>
      <PageHead
        title="Notices"
        sub="Notices your clients received, the nearest date first. A date InboxCA found is only a suggestion until someone confirms it against the notice."
        actions={
          <Link className="b b-primary" href="/app/notices?add=1">
            <Plus size={15} aria-hidden />
            Add a notice
          </Link>
        }
      />
      {error === "notice" && (
        <p className="alert" role="alert">
          Choose the client, the authority and the day it was received.
        </p>
      )}
      {add && (
        <section className="reveal-panel" aria-labelledby="add-notice">
          <Link className="b b-ghost b-small reveal-close" href="/app/notices" scroll={false}>
            Close
          </Link>
          <h3 id="add-notice">Add a notice</h3>
          <form action={manageNotice} className="fields">
            <div>
              <label htmlFor="notice-client">Client</label>
              <select id="notice-client" name="client" required>
                {clients?.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="notice-authority">Authority</label>
              <select id="notice-authority" name="authority">
                {Object.entries(authorities).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="notice-type">Notice</label>
              <input id="notice-type" name="type" list="notice-types" maxLength={80} placeholder="Notice u/s 148" />
              <datalist id="notice-types">
                {catalog.map((type) => (
                  <option key={type} value={type} />
                ))}
              </datalist>
            </div>
            <div>
              <label htmlFor="notice-reference">Reference or DIN</label>
              <input id="notice-reference" name="reference" maxLength={60} className="num" />
            </div>
            <div>
              <label htmlFor="notice-received">Received on</label>
              <input id="notice-received" name="received" type="date" defaultValue={today} required />
            </div>
            <div>
              <label htmlFor="notice-date">Action date, as the notice states it</label>
              <input id="notice-date" name="date" type="date" />
            </div>
            <button className="b b-primary" name="intent" value="add">
              Add notice
            </button>
          </form>
        </section>
      )}
      <section className="panel" aria-labelledby="open-notices">
        <h2 id="open-notices">Open: {open?.length ?? 0}</h2>
        {open?.length ? (
          table(open)
        ) : (
          <Empty Icon={FileWarning} title="No open notices">
            <span>A notice a client emails is recorded here by itself. Add one by hand with Add a notice.</span>
          </Empty>
        )}
      </section>
      {!!done?.length && (
        <section className="panel" aria-labelledby="done-notices">
          <h2 id="done-notices">Replied and closed</h2>
          {table(done)}
        </section>
      )}
    </>
  );
}
