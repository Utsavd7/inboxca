"use client";
import { MailPlus } from "lucide-react";
import { useActionState } from "react";
import { inviteMember, type InviteState } from "@/app/(app)/actions";
import { IconTile, SidePanel, Toast } from "../ui";
import { RoleChoice } from "./role-choice";

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
        <RoleChoice value={state.values?.role ?? "staff"} />
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
