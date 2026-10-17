"use client";
import Link from "next/link";
import { useActionState } from "react";
import { addClient, type ClientState } from "@/app/(app)/actions";
import { clientKinds } from "@/src/lib/clients";

export function AddClientForm() {
  const [state, add, adding] = useActionState(addClient, {} as ClientState);
  return (
    <section className="reveal-panel" aria-labelledby="add-client">
      <Link className="b b-ghost b-small reveal-close" href="/app/clients" scroll={false}>
        Close
      </Link>
      <h3 id="add-client">Add a client</h3>
      <p className="hint">Only the name is needed. Add the email, PAN and GSTIN if you have them; InboxCA uses them to recognise the client&apos;s emails and documents.</p>
      <form key={JSON.stringify(state.values)} action={add} className="fields" noValidate>
        <div>
          <label htmlFor="client-name">Name</label>
          <input id="client-name" name="name" required defaultValue={state.values?.name} aria-invalid={!!state.error} />
        </div>
        <div>
          <label htmlFor="client-kind">Kind</label>
          <select id="client-kind" name="kind" defaultValue={state.values?.kind ?? "individual"}>
            {Object.entries(clientKinds).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="client-email">Email</label>
          <input id="client-email" name="email" type="email" autoComplete="off" defaultValue={state.values?.email} />
        </div>
        <div>
          <label htmlFor="client-pan">PAN</label>
          <input id="client-pan" name="pan" autoComplete="off" maxLength={10} className="num" defaultValue={state.values?.pan} />
        </div>
        <div>
          <label htmlFor="client-gstin">GSTIN</label>
          <input id="client-gstin" name="gstin" autoComplete="off" maxLength={15} className="num" defaultValue={state.values?.gstin} />
        </div>
        <button className="b b-primary" type="submit" disabled={adding}>
          {adding ? "Adding" : "Add client"}
        </button>
      </form>
      {state.error && (
        <p className="alert" role="alert">
          {state.error}
        </p>
      )}
    </section>
  );
}
