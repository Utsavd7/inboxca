import { Bell, FileCheck2, FileText, Inbox, Landmark, Phone, ShieldCheck, TriangleAlert } from "lucide-react";
import { reviewOwnerDevice, seenAlert, setOfficeOnly } from "@/app/(app)/actions";
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

// The rows of a person's list, Today's and the full one: what to do, the client, why now and one
// button. Red when late or held up near its due date. more adds the hover actions of a row. j and
// k move between the rows' buttons, Enter presses one; each page is fetched on hover.
export function WorkRows({ items, today, membership, name, more }: { items: Listed[]; today: string; membership: Member; name: string; more?: (item: Listed) => React.ReactNode }) {
  return (
    <>
      <RowKeys rows=".work-rows > .app-row" target=".row-end > a:last-child, .row-end > form:last-child button" />
      <List name={name} className="app-rows work-rows">
        {items.map((item) => {
          const red = item.urgent || (!!item.due && item.due < today);
          const [Icon, kind] = red ? [TriangleAlert, "late" as const] : item.key.startsWith("call:") ? [Phone, "notice" as const] : /^(computer|office):/.test(item.key) ? [ShieldCheck, "approve" as const] : icons[item.area];
          const client = item.client && !item.title.includes(item.client.name) ? item.client.name : null;
          return (
            <Row
              key={item.key}
              lead={<IconTile Icon={Icon} kind={kind} />}
              title={item.title}
              meta={
                <>
                  {client && <span className="work-client">{client}</span>}
                  <span className={red ? "work-why is-red" : "work-why"}>{item.why}</span>
                </>
              }
              more={more?.(item)}
              action={<Action item={item} membership={membership} />}
            />
          );
        })}
      </List>
    </>
  );
}

// The row's one button: Fill for a return not filled yet, Got it for a file with a virus, the
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
