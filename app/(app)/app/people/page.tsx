import { redirect } from "next/navigation";
import { changeGroup, manageMember } from "@/app/(app)/actions";
import { currentMember } from "@/src/lib/member";
import { AutoSelect } from "../auto-select";
import { Avatar, PageHead } from "../ui";
import { invitableRoles, roleLabel } from "@/src/lib/roles";
import { InviteForm } from "./invite-form";

const statusNames: Record<string, string> = { invited: "Invited", deactivated: "Removed" };

// The firm's people. Everyone in the firm sees the list; only the owner invites, changes
// roles and removes people.
export default async function People() {
  const { supabase, userId, membership } = await currentMember();
  if (!membership) redirect("/app");
  const [{ data: people }, { data: groups }] = await Promise.all([
    supabase.rpc("firm_people", { target_firm: membership.firmId }),
    supabase.from("groups").select("id, kind, name").in("kind", ["team", "branch"]).order("name"),
  ]);
  const groupName = new Map(groups?.map((group) => [group.id, group.name]));
  // A person is in at most one team and works at most at one branch.
  const kinds = [
    { kind: "team", column: "team_id", title: "Teams", one: "team" },
    { kind: "branch", column: "branch_id", title: "Branches", one: "branch" },
  ] as const;
  const groupsOf = (kind: string) => groups?.filter((group) => group.kind === kind) ?? [];
  const size = (column: "team_id" | "branch_id", id: string) => {
    const count = people?.filter((person) => person[column] === id).length ?? 0;
    return `${count} ${count === 1 ? "person" : "people"}`;
  };
  const isOwner = membership.role === "owner";

  return (
    <>
      <PageHead title="People" sub="Everyone in your firm, the teams they work in and the branches they work at." />
      <section className="panel" aria-labelledby="people">
        <div className="panel-head">
          <h2 id="people">{membership.firmName}</h2>
          {isOwner && <p className="hint">A change saves as soon as you pick it.</p>}
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Role</th>
                {kinds.map(({ kind, one }) => groupsOf(kind).length > 0 && <th key={kind} scope="col">{one[0].toUpperCase() + one.slice(1)}</th>)}
                <th scope="col" className="shrink">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {people?.map((person) => {
                const editable = isOwner && person.user_id !== userId && person.status !== "deactivated";
                // Keyed on the saved values, so the form shows them after each change.
                const form = `person-${person.user_id}`;
                return (
                  <tr key={person.user_id + person.role + person.status + person.team_id + person.branch_id} className={person.status === "deactivated" ? "is-off" : undefined}>
                    <td>
                      <span className="who">
                        <Avatar name={person.email} />
                        <span className="name">{person.email}</span>
                        {statusNames[person.status] && <span className={`badge tag-${person.status}`}>{statusNames[person.status]}</span>}
                      </span>
                    </td>
                    <td className="shrink">
                      {editable ? (
                        <AutoSelect save="role" form={form} name="role" defaultValue={person.role} aria-label={`Role for ${person.email}`}>
                          {invitableRoles.map((role) => (
                            <option key={role} value={role}>
                              {roleLabel(role)}
                            </option>
                          ))}
                        </AutoSelect>
                      ) : (
                        roleLabel(person.role)
                      )}
                    </td>
                    {kinds.map(({ kind, column, one }) =>
                      groupsOf(kind).length ? (
                        <td key={kind} className="shrink">
                          {editable ? (
                            <AutoSelect save="role" form={form} name={kind} defaultValue={person[column] ?? ""} aria-label={`${one[0].toUpperCase() + one.slice(1)} for ${person.email}`}>
                              <option value="">No {one}</option>
                              {groupsOf(kind).map((group) => (
                                <option key={group.id} value={group.id}>
                                  {group.name}
                                </option>
                              ))}
                            </AutoSelect>
                          ) : (
                            <span className="hint">{groupName.get(person[column] ?? "") ?? `No ${one}`}</span>
                          )}
                        </td>
                      ) : null,
                    )}
                    <td className="shrink">
                      {isOwner && person.user_id !== userId && (
                        <form id={form} action={manageMember}>
                          <input type="hidden" name="person" value={person.user_id} />
                          <button hidden name="intent" value="role" />
                          {person.status === "deactivated" ? (
                            <button className="b b-secondary b-small" name="intent" value="restore">
                              Bring back
                            </button>
                          ) : (
                            <button className="b b-ghost b-small" name="intent" value="remove">
                              {person.status === "invited" ? "Withdraw invite" : "Remove"}
                            </button>
                          )}
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {kinds.map(({ kind, column, title, one }) =>
        isOwner || groupsOf(kind).length ? (
          <section key={kind} className="panel" aria-labelledby={title.toLowerCase()}>
            <h2 id={title.toLowerCase()}>{title}</h2>
            <ul className="rows">
              {groupsOf(kind).map((group) => (
                <li key={group.id}>
                  <span className="name">{group.name}</span>
                  <span className="end">
                    {size(column, group.id)}
                    {isOwner && (
                      <form action={changeGroup}>
                        <input type="hidden" name="kind" value={kind} />
                        <input type="hidden" name="group" value={group.id} />
                        <button className="b b-ghost b-small" name="intent" value="remove">
                          Remove {one}
                        </button>
                      </form>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {isOwner && (
              <form action={changeGroup} className="form-row">
                <input type="hidden" name="kind" value={kind} />
                <div>
                  <label htmlFor={`${kind}-name`}>New {one}</label>
                  <input id={`${kind}-name`} name="name" required maxLength={120} />
                </div>
                <button className="b b-secondary" type="submit">
                  Add {one}
                </button>
              </form>
            )}
          </section>
        ) : null,
      )}
      {isOwner && <InviteForm />}
    </>
  );
}
