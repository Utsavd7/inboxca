import { Building2, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { changeGroup, manageMember } from "@/app/(app)/actions";
import { currentMember } from "@/src/lib/member";
import { Avatar, Badge, Empty, IconTile, NotForYou, PageHead, SidePanel, Toast, type Tone } from "../ui";
import { Item, List, Presence } from "../motion";
import { Pending } from "../pending";
import { invitableRoles, personName, roleLabel } from "@/src/lib/roles";
import { InviteForm } from "./invite-form";
import "./people.css";

const statusNames: Record<string, string> = { active: "Active", invited: "Invited", deactivated: "Removed" };
const statusTones: Record<string, Tone> = { active: "done", invited: "warn" };
// Each role keeps one colour on its pill; the colour names the role, the word says it.
const roleTones: Record<string, Tone> = { owner: "purple", partner: "blue", manager: "blue" };
// What a change on a person says once it is saved (?saved=).
const savedNames: Record<string, string> = { role: "Changes saved.", remove: "Removed from the firm.", restore: "Restored. They can sign in again." };
// A person is in at most one team and works at most at one branch.
const kinds = [
  { kind: "team", column: "team_id", title: "Teams", one: "Team", Icon: Users },
  { kind: "branch", column: "branch_id", title: "Branches", one: "Branch", Icon: Building2 },
] as const;

// The firm's people. Everyone who opens People sees the list; only the owner invites,
// changes roles, teams and branches, and removes people, each in a panel beside the list.
export default async function People({ searchParams }: { searchParams: Promise<{ panel?: string; person?: string; confirm?: string; saved?: string }> }) {
  const { supabase, userId, membership } = await currentMember();
  if (!membership) redirect("/app");
  if (!["owner", "partner", "manager"].includes(membership.role)) return <NotForYou title="People" who="the owner, partners and managers" />;
  const [{ data: people }, { data: groups }] = await Promise.all([
    supabase.rpc("firm_people", { target_firm: membership.firmId }),
    supabase.from("groups").select("id, kind, name").in("kind", ["team", "branch"]).order("name"),
  ]);
  const { panel, person: chosen, confirm, saved } = await searchParams;
  const groupName = new Map(groups?.map((group) => [group.id, group.name]));
  const groupsOf = (kind: string) => groups?.filter((group) => group.kind === kind) ?? [];
  const size = (column: "team_id" | "branch_id", id: string) => {
    const count = people?.filter((person) => person[column] === id).length ?? 0;
    return `${count} ${count === 1 ? "person" : "people"}`;
  };
  const isOwner = membership.role === "owner";
  const shownKinds = kinds.filter(({ kind }) => groupsOf(kind).length);
  const person = isOwner && chosen !== userId ? people?.find((one) => one.user_id === chosen) : undefined;
  const count = people?.filter((one) => one.status !== "deactivated").length ?? 0;

  return (
    <div className="people-page">
      <PageHead
        title="People"
        sub={`${count} ${count === 1 ? "person" : "people"} in ${membership.firmName}, with their role, team and branch.`}
        actions={
          <>
            {(isOwner || !!groups?.length) && (
              <Link className="b b-secondary" href="/app/people?panel=groups" scroll={false}>
                Teams and branches
              </Link>
            )}
            {isOwner && (
              <Link className="b b-primary" href="/app/people?panel=invite" scroll={false}>
                <UserPlus size={16} aria-hidden />
                Invite person
              </Link>
            )}
          </>
        }
      />
      <div className="people-table">
        <table className="t">
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Role</th>
              {shownKinds.map(({ kind, one }) => (
                <th key={kind} scope="col">
                  {one}
                </th>
              ))}
              <th scope="col">Status</th>
              {isOwner && (
                <th scope="col" className="shrink">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <List as="tbody">
            {people?.map((one) => (
              <Item as="tr" key={one.user_id} className={`${one.status === "deactivated" ? "is-off" : ""}${one.user_id === person?.user_id ? " on" : ""}`}>
                <td>
                  <span className="people-who">
                    <Avatar name={one.email} />
                    <span className="grow">
                      <strong>
                        {personName(one.email)}
                        {one.user_id === userId && <span className="sub-inline">You</span>}
                      </strong>
                      <span className="sub">{one.email}</span>
                    </span>
                  </span>
                </td>
                <td>
                  <Badge tone={roleTones[one.role]} plain>
                    {roleLabel(one.role)}
                  </Badge>
                </td>
                {shownKinds.map(({ kind, column, one: label }) => (
                  <td key={kind}>{groupName.get(one[column] ?? "") ?? <span className="hint">No {label.toLowerCase()}</span>}</td>
                ))}
                <td>
                  <Badge tone={statusTones[one.status]}>{statusNames[one.status]}</Badge>
                </td>
                {isOwner && (
                  <td className="shrink">
                    {one.user_id !== userId && (
                      <Link className="b b-secondary" href={`/app/people?person=${one.user_id}`} scroll={false} aria-label={`Change ${one.email}`}>
                        Change
                      </Link>
                    )}
                  </td>
                )}
              </Item>
            ))}
          </List>
        </table>
      </div>
      {count <= 1 && (
        <div className="panel">
          <Empty Icon={UserPlus} kind="reply" title="Just you so far">
            <span>Invite your partners and staff. Each gets their own sign in, and you choose what their role may do.</span>
            {isOwner && (
              <Link className="b b-primary" href="/app/people?panel=invite" scroll={false}>
                Invite your team
              </Link>
            )}
          </Empty>
        </div>
      )}

      <Presence>
      {isOwner && panel === "invite" && <InviteForm key="invite" />}

      {person && (
        <SidePanel key="person" id="person" title={person.email} close="/app/people">
          <div className="people-card">
            <Avatar name={person.email} big />
            <span className="grow">
              <strong>{personName(person.email)}</strong>
              <span className="sub">{person.email}</span>
            </span>
            <Badge tone={statusTones[person.status]}>{statusNames[person.status]}</Badge>
          </div>
          {/* Keyed on the saved values, so the form shows them after each change. */}
          <form key={person.role + person.status + person.team_id + person.branch_id} action={manageMember} className="fields">
            <input type="hidden" name="person" value={person.user_id} />
            {person.status === "deactivated" ? (
              <p className="hint">Removed from the firm. Restore them to let them sign in again.</p>
            ) : (
              <>
                <div>
                  <label htmlFor="person-role">Role</label>
                  <select id="person-role" name="role" defaultValue={person.role}>
                    {invitableRoles.map((role) => (
                      <option key={role} value={role}>
                        {roleLabel(role)}
                      </option>
                    ))}
                  </select>
                </div>
                {kinds.map(({ kind, column, one }) =>
                  groupsOf(kind).length ? (
                    <div key={kind}>
                      <label htmlFor={`person-${kind}`}>{one}</label>
                      <select id={`person-${kind}`} name={kind} defaultValue={person[column] ?? ""}>
                        <option value="">No {one.toLowerCase()}</option>
                        {groupsOf(kind).map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null,
                )}
                <Pending busy="Saving" className="b b-primary" name="intent" value="role">
                  Save changes
                </Pending>
              </>
            )}
            <div className="people-leave">
              {person.status === "deactivated" ? (
                <Pending className="b b-primary" name="intent" value="restore" busy="Restoring">
                  Restore
                </Pending>
              ) : person.status === "invited" ? (
                <>
                  <p className="hint">The invite stops working.</p>
                  <Pending className="b b-secondary" name="intent" value="remove" busy="Removing">
                    Withdraw invite
                  </Pending>
                </>
              ) : confirm === "remove" ? (
                <>
                  <p className="hint">Remove {personName(person.email)} from the firm? They lose access at once. You can restore them later.</p>
                  <Pending className="b b-danger" name="intent" value="remove" busy="Removing">
                    Yes, remove from the firm
                  </Pending>
                  <Link className="b b-secondary" href={`/app/people?person=${person.user_id}`} scroll={false}>
                    Cancel
                  </Link>
                </>
              ) : (
                <>
                  <p className="hint">They lose access at once. You can restore them later.</p>
                  <Link className="b b-secondary" href={`/app/people?person=${person.user_id}&confirm=remove`} scroll={false}>
                    Remove from the firm
                  </Link>
                </>
              )}
            </div>
          </form>
        </SidePanel>
      )}

      {panel === "groups" && (isOwner || !!groups?.length) && (
        <SidePanel key="groups" id="groups" title="Teams and branches" close="/app/people">
          <p className="hint">Group people into teams, and say which branch each works at. Clients can then be given to a whole team.</p>
          {kinds.map(({ kind, column, title, one, Icon }) => (
            <section key={kind} aria-labelledby={title.toLowerCase()}>
              <h3 id={title.toLowerCase()} className="people-group-head">
                <IconTile Icon={Icon} kind={kind === "team" ? "reply" : "week"} />
                {title}
              </h3>
              {groupsOf(kind).length ? (
                <List name={kind} className="people-groups" rise={false}>
                  {groupsOf(kind).map((group) => (
                    <Item key={group.id}>
                      <span className="grow">{group.name}</span>
                      <span className="hint">{size(column, group.id)}</span>
                      {isOwner && (
                        <form action={changeGroup}>
                          <input type="hidden" name="kind" value={kind} />
                          <input type="hidden" name="group" value={group.id} />
                          <Pending className="b b-ghost" name="intent" value="remove" aria-label={`Remove ${one.toLowerCase()} ${group.name}`}>
                            Remove
                          </Pending>
                        </form>
                      )}
                    </Item>
                  ))}
                </List>
              ) : (
                <p className="hint">No {title.toLowerCase()} yet.</p>
              )}
              {isOwner && (
                <form action={changeGroup} className="form-row">
                  <input type="hidden" name="kind" value={kind} />
                  <div>
                    <label htmlFor={`${kind}-name`}>New {one.toLowerCase()}</label>
                    <input id={`${kind}-name`} name="name" required maxLength={120} />
                  </div>
                  <Pending className="b b-secondary" type="submit" busy="Adding">
                    Add {one.toLowerCase()}
                  </Pending>
                </form>
              )}
            </section>
          ))}
        </SidePanel>
      )}
      </Presence>
      {saved && savedNames[saved] && <Toast>{savedNames[saved]}</Toast>}
    </div>
  );
}
