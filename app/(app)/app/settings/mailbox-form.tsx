"use client";
import { useActionState } from "react";
import { connectMailbox, type MailboxState } from "@/app/(app)/actions";

// Connect the firm's mailbox: the address and its password; server settings only when
// InboxCA cannot find them by itself.
export function MailboxForm() {
  const [state, connect, connecting] = useActionState(connectMailbox, {} as MailboxState);
  const values = state.values ?? {};
  return (
    <form key={JSON.stringify(values)} action={connect} noValidate>
      <div className="app-grid-form">
        <div>
          <label htmlFor="mail-address">The firm&apos;s email address</label>
          <input id="mail-address" name="address" type="email" autoComplete="off" required defaultValue={values.address} />
        </div>
        <div>
          <label htmlFor="mail-password">Its password</label>
          <input id="mail-password" name="password" type="password" autoComplete="new-password" required />
        </div>
        <button className="btn" type="submit" disabled={connecting}>
          {connecting ? "Checking" : "Connect email"}
        </button>
      </div>
      <p className="app-note">Gmail, Google Workspace and Zoho need an app password, made in the account&apos;s security settings.</p>
      <details className="app-details" open={!!values.imap_host}>
        <summary>Server settings, only if InboxCA asks</summary>
        <div className="app-grid-form">
          {[
            ["imap_host", "Incoming (IMAP) server"],
            ["imap_port", "Incoming port"],
            ["smtp_host", "Outgoing (SMTP) server"],
            ["smtp_port", "Outgoing port"],
          ].map(([name, label]) => (
            <div key={name}>
              <label htmlFor={`mail-${name}`}>{label}</label>
              <input id={`mail-${name}`} name={name} autoComplete="off" inputMode={name.endsWith("port") ? "numeric" : undefined} defaultValue={values[name]} />
            </div>
          ))}
        </div>
      </details>
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
