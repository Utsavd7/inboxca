import { Globe, Landmark } from "lucide-react";
import { redirect } from "next/navigation";
import { currentMember } from "@/src/lib/member";
import { governmentUpdates, govNote, govTitle, govWhen } from "@/src/lib/work/government";
import { List } from "../motion";
import { Pending } from "../pending";
import { Badge, Card, Empty, PageHead, Row } from "../ui";
import { dismissGovUpdate } from "./actions";
import "./government.css";

// From the government: everything the daily check found in the last 14 days for this firm's
// work, newest first, and the official pages InboxCA cannot read by itself.
export default async function Government() {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const { items, unread } = await governmentUpdates(supabase, membership.firmId);
  return (
    <>
      <PageHead title="From the government" sub="New forms, tools and news from government sites, for the services you do for your clients. InboxCA checks these sites every morning at 08:30." />
      <Card id="gov-new" title="Last 14 days" Icon={Landmark} kind="docs" count={items.length} className="gov-list">
        {items.length ? (
          <List name="gov" className="app-rows">
            {items.map((item) => (
              <Row
                key={item.id}
                title={govTitle(item)}
                meta={[`${item.from}, ${govWhen(item)}.`, govNote(item)].filter(Boolean).join(" ")}
                status={item.dismissed ? <Badge plain>Dismissed</Badge> : undefined}
                action={
                  <span className="form-row">
                    <a className="b b-secondary b-small" href={item.link} target="_blank" rel="noopener noreferrer">Open</a>
                    {!item.dismissed && (
                      <form action={dismissGovUpdate}>
                        <input type="hidden" name="item" value={item.id} />
                        <Pending className="b b-ghost b-small">Dismiss</Pending>
                      </form>
                    )}
                  </span>
                }
              />
            ))}
          </List>
        ) : (
          <Empty Icon={Landmark} title="Nothing new from the government" kind="docs">
            <p className="hint">When a government site adds something for the services you do for your clients, it shows here for 14 days.</p>
          </Empty>
        )}
      </Card>
      {!!unread.length && (
        <Card id="gov-unread" title="Pages to check yourself" Icon={Globe} kind="week" className="gov-list">
          <List name="gov-unread" className="app-rows">
            {unread.map((source) => (
              <Row
                key={source.key}
                title={source.name}
                meta="InboxCA could not check this page. Look at it yourself."
                action={<a className="b b-ghost b-small" href={source.url} target="_blank" rel="noopener noreferrer">Open</a>}
              />
            ))}
          </List>
        </Card>
      )}
    </>
  );
}
