"use client";
import { MailPlus } from "lucide-react";
import { useActionState } from "react";
import { inviteMember, type InviteState } from "@/app/(app)/actions";
import { invitableRoles, roleLabel } from "@/src/lib/roles";
import { IconTile, SidePanel, Toast } from "../ui";

export function InviteForm() {
  const [state, invite, inviting] = useActionState(inviteMember, {} as InviteState);
  return (
    <SidePanel id="invite" title="Invite person" close="/app/people">
      <div className="people-intro">
        <IconTile Icon={MailPlus} kind="reply" />
        <p className="hint">They get an email with a sign in code, then set up their 2 step code. Their role decides what they may do.</p>
      </div>
      <form key={JSON.stringify(state.values)} action={invite} className="fields" noValidate>
        <div>
          <label htmlFor="invite-email">Their work email</label>
          <input
            id="invite-email"
            name="email"
            type="email"
            autoComplete="off"
            required
            defaultValue={state.values?.email}
            aria-invalid={!!state.error}
            aria-describedby={state.error ? "invite-error" : undefined}
          />
        </div>
        <div>
          <label htmlFor="invite-role">Role</label>
          <select id="invite-role" name="role" defaultValue={state.values?.role ?? "staff"}>
            {invitableRoles.map((role) => (
              <option key={role} value={role}>
                {roleLabel(role)}
              </option>
            ))}
          </select>
        </div>
        <button className="b b-primary" type="submit" disabled={inviting} aria-busy={inviting || undefined}>
          {inviting ? "Sending invite" : "Send invite"}
        </button>
      </form>
      {state.error && (
        <p className="alert" id="invite-error" role="alert">
          {state.error}
        </p>
      )}
      {state.done && <Toast>{state.done}</Toast>}
    </SidePanel>
  );
}
