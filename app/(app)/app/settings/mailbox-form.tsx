"use client";
import { useActionState, useState } from "react";
import { connectMailbox, findMailServer, type MailboxState } from "@/app/(app)/actions";

// Connect the firm's mailbox: the address and its password. InboxCA finds the servers and
// says what it found; the server settings are changed only when it cannot find them.
export function MailboxForm({initial={},reconnecting=false}:{initial?:Record<string,string>;reconnecting?:boolean}) {
  const [state, connect, connecting] = useActionState(connectMailbox, {values:initial} as MailboxState);
  const values = state.values ?? {};
  const [found, setFound] = useState("");
  return (
    <form key={JSON.stringify(values)} action={connect} noValidate>
      <div className="fields">
        <div>
          <label htmlFor="mail-address">The firm&apos;s email address</label>
          <input id="mail-address" name="address" type="email" autoComplete="off" required readOnly={reconnecting} defaultValue={values.address} onBlur={(event) => findMailServer(event.target.value).then(setFound, () => setFound(""))} />
        </div>
        <div>
          <label htmlFor="mail-password">Its password</label>
          <input id="mail-password" name="password" type="password" autoComplete="new-password" required />
        </div>
        <button className="b b-primary" type="submit" disabled={connecting} aria-busy={connecting || undefined}>
          {connecting ? "Connecting" : reconnecting ? "Reconnect email" : "Connect email"}
        </button>
      </div>
      <p className="hint" aria-live="polite">{found || "Gmail, Google Workspace and Zoho need an app password, made in the account's security settings."}{connecting && " Connecting..."}</p>
      <details className="reveal" open={!!state.error && !!values.imap_host}>
        <summary>Change server settings</summary>
        <div className="fields">
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
        <p className="alert" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
