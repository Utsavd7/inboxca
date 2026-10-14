"use client";
import { useActionState } from "react";
import { inviteMember, type InviteState } from "@/app/(app)/actions";

export function InviteForm() {
  const [state, invite, inviting] = useActionState(inviteMember, {} as InviteState);
  return (
    <section className="app-card" aria-labelledby="invite">
      <h2 id="invite">Invite someone</h2>
      <form action={invite} className="auth-form app-invite" noValidate>
        <div>
          <label htmlFor="invite-email">Their work email</label>
          <input
            id="invite-email"
            name="email"
            type="email"
            autoComplete="off"
            required
            aria-invalid={!!state.error}
            aria-describedby={state.error ? "invite-error" : undefined}
          />
        </div>
        <div>
          <label htmlFor="invite-role">Role</label>
          <select id="invite-role" name="role" defaultValue="staff">
            <option value="partner">Partner</option>
            <option value="manager">Manager</option>
            <option value="staff">Staff</option>
            <option value="front_desk">Front desk</option>
          </select>
        </div>
        <button className="btn" type="submit" disabled={inviting}>
          {inviting ? "Inviting" : "Invite"}
        </button>
      </form>
      {state.error && (
        <p className="field-error" id="invite-error" role="alert">
          {state.error}
        </p>
      )}
      {state.done && (
        <p className="app-done" role="status">
          {state.done}
        </p>
      )}
    </section>
  );
}
