import { Bell, FileCheck2, FileText, Inbox, Landmark, ListChecks, Phone, Scale, ShieldCheck, TriangleAlert } from "lucide-react";
import { checkFigures, manageClient, reviewOwnerDevice, saveLink, seenAlert, setOfficeOnly } from "@/app/(app)/actions";
import { dueLabel } from "@/src/lib/calendar";
import { canManageClients } from "@/src/lib/clients";
import type { currentMember } from "@/src/lib/member";
import type { Listed } from "@/src/lib/work/today";
import { Fill } from "./fill";
import { List } from "./motion";
import { Pending } from "./pending";
import { RowKeys } from "./row-keys";
import { IconTile, Row } from "./ui";
import { WarmLink } from "./ui-client";
import "./work.css";

type Member = NonNullable<Awaited<ReturnType<typeof currentMember>>["membership"]>;
const icons = { papers: [FileText, "papers"], returns: [FileCheck2, "approve"], emails: [Inbox, "reply"], gov: [Landmark, "notice"], firm: [Bell, "notice"] } as const;

// The rows of a person's list, Today's and the full one: its date (red only when late, an icon
// for what has none), the client in bold then the return or what it is, one short status and one
// button. more adds the hover actions of a row. j and k move between the rows' buttons, Enter
// presses one; each page is fetched on hover.
export function WorkRows({ items, today, membership, name, more }: { items: Listed[]; today: string; membership: Member; name: string; more?: (item: Listed) => React.ReactNode }) {
  return (
    <>
      <RowKeys rows=".work-rows > .app-row" target=".row-end > a:last-child, .row-end > form:last-child button" />
      <List name={name} className="app-rows work-rows">
        {items.map((item) => {
          const late = !!item.due && item.due < today;
          const red = late || (!!item.urgent && !item.due);
          const [Icon, kind] = red ? [TriangleAlert, "late" as const] : item.key.startsWith("call:") ? [Phone, "notice" as const] : /^(computer|office):/.test(item.key) ? [ShieldCheck, "approve" as const] : item.key.startsWith("todo:") ? [ListChecks, "approve" as const] : icons[item.area];
          const client = item.client && !item.title.includes(item.client.name) ? item.client.name : null;
          const what = (
            <>
              {client && <span className="work-client">{client}</span>}
              <span className={client ? "work-what" : undefined}>
                {item.key.startsWith("notice:") && <Scale className="work-mark" size={14} aria-hidden />}
                {item.title}
              </span>
            </>
          );
          return (
            <Row
              key={item.key}
              lead={<span className="work-lead">{item.due ? <DueChip due={item.due} late={late} /> : <IconTile Icon={Icon} kind={kind} />}</span>}
              title={what}
              meta={<span className={red ? "work-why is-red" : "work-why"}>{item.why}</span>}
              more={more?.(item)}
              action={<Action item={item} membership={membership} />}
            />
          );
        })}
      </List>
    </>
  );
}

// When it is due, as the client's Work rows show it: the month over the day.
function DueChip({ due, late }: { due: string; late: boolean }) {
  const [day, month] = dueLabel(due).split(" ");
  return (
    <span className={`work-date${late ? " is-late" : ""}`}>
      <span aria-hidden>{month}</span>
      <strong aria-hidden>{day}</strong>
      <span className="sr-only">
        {late ? "Was due" : "Due"} {dueLabel(due)}
      </span>
    </span>
  );
}

// The row's one button: Fill for a return not filled yet, Got it for a file kept out, Save for
// a file from a sharing link, the
// yes to a new computer or office connection, the official page in a new tab, or the page
// where it is done.
function Action({ item, membership }: { item: Listed; membership: Member }) {
  const { label, href } = item.action;
  const named = item.title.startsWith(label) ? item.title : `${label}: ${item.client?.name ?? item.title}`;
  if (item.key.startsWith("fill:") && item.client && !membership.viewOnlyUntil && membership.may("edit_figures", item.client.id)) return <Fill task={item.key.slice(5)} label={item.title} />;
  if (item.key.startsWith("virus:"))
    return (
      <form action={seenAlert}>
        <input type="hidden" name="alert" value={item.key.slice(6)} />
        <Pending className="b b-secondary">{label}</Pending>
      </form>
    );
  // A client's to-do: Done for those who may change the client and for its own person (mine),
  // else the client's page.
  if (item.key.startsWith("todo:") && item.client)
    return (canManageClients(membership.role) || item.mine) && !membership.viewOnlyUntil ? (
      <form action={manageClient}>
        <input type="hidden" name="client" value={item.client.id} />
        <input type="hidden" name="todo" value={item.key.slice(5)} />
        <input type="hidden" name="from" value="today" />
        <Pending className="b b-secondary" name="intent" value="todo-done" aria-label={`Done: ${item.title}`}>{label}</Pending>
      </form>
    ) : (
      <WarmLink className="b b-secondary" href={href} aria-label={`See ${item.client.name}`}>See client</WarmLink>
    );
  // Every TDS paper in: the statement page opens, and the card leaves the list.
  if (item.key.startsWith("tds_in:"))
    return (
      <form action={checkFigures}>
        <input type="hidden" name="request" value={item.key.slice(7)} />
        <Pending className="b b-secondary" aria-label={named}>{label}</Pending>
      </form>
    );
  if (item.key.startsWith("link:"))
    return (
      <form action={saveLink}>
        <input type="hidden" name="alert" value={item.key.slice(5)} />
        <Pending className="b b-primary" busy="Saving">{label}</Pending>
      </form>
    );
  if (item.key.startsWith("computer:"))
    return (
      <form action={reviewOwnerDevice}>
        <input type="hidden" name="request" value={item.key.slice(9)} />
        <Pending className="b b-secondary" name="decision" value="approve" aria-label={named}>
          {label}
        </Pending>
      </form>
    );
  if (item.key.startsWith("office:")) {
    const [, intent, request] = item.key.split(":");
    return (
      <form action={setOfficeOnly}>
        <input type="hidden" name="request" value={request} />
        <input type="hidden" name="back" value="today" />
        <Pending className="b b-secondary" name="intent" value={intent} aria-label={named}>
          {label}
        </Pending>
      </form>
    );
  }
  if (/^https?:/.test(href))
    return (
      <a className="b b-secondary" href={href} target="_blank" rel="noopener noreferrer" aria-label={named}>
        {label}
      </a>
    );
  return (
    <WarmLink className="b b-secondary" href={href} aria-label={named}>
      {label}
    </WarmLink>
  );
}
