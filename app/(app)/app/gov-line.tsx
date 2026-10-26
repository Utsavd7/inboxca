import { Landmark } from "lucide-react";
import Link from "next/link";
import { currentMember } from "@/src/lib/member";
import { governmentUpdates, govNote, govTitle, govWhen } from "@/src/lib/work/government";
import { dismissGovUpdate } from "./government/actions";
import { Item, List } from "./motion";
import { Pending } from "./pending";
import "./government/government.css";

// Today's one calm line about what is new from the government for this firm's work: the newest
// item this person has not dismissed, with the official link and Dismiss, and how many more
// wait in the full list. Nothing shows when there is none, or if the list cannot be read.
export async function GovLine() {
  const { supabase, membership } = await currentMember();
  if (!membership) return null;
  const items = await governmentUpdates(supabase, membership.firmId).then(({ items }) => items.filter((item) => !item.dismissed), () => []);
  const [item] = items, note = item && govNote(item);
  return (
    <List name="gov-line" className="gov-lines" rise={false}>
      {item && (
        <Item key={item.id} className="today-line gov-line">
          <Landmark size={16} aria-hidden />
          <p className="grow" title={`${govTitle(item)} ${item.from}, ${govWhen(item)}.`}>
            <strong>New from the government:</strong> {govTitle(item)} {item.from}, {govWhen(item)}.{note && ` ${note}`}
          </p>
          <span className="form-row">
            <a className="b b-secondary b-small" href={item.link} target="_blank" rel="noopener noreferrer">Open</a>
            <form action={dismissGovUpdate}>
              <input type="hidden" name="item" value={item.id} />
              <Pending className="b b-ghost b-small">Dismiss</Pending>
            </form>
            {items.length > 1 && <Link href="/app/government">and {items.length - 1} more</Link>}
          </span>
        </Item>
      )}
    </List>
  );
}
