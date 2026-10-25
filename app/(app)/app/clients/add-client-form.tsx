"use client";
import { useActionState } from "react";
import { addClient, type ClientState } from "@/app/(app)/actions";
import { clientKinds } from "@/src/lib/clients";
import { SidePanel } from "../ui";

// The field an error is about, so it shows under that field; the rest show under the button.
const fieldOf = (error = "") =>
  error.includes("name") ? "name" : error.startsWith("That GSTIN") ? "gstin" : error.includes("PAN") ? "pan" : error.includes("email") ? "email" : "";

export function AddClientForm() {
  const [state, add, adding] = useActionState(addClient, {} as ClientState);
  const field = fieldOf(state.error);
  const mark = (name: string) => (field === name ? { "aria-invalid": true, "aria-describedby": "add-client-error" } : {});
  const error = (name: string) =>
    field === name && (
      <p className="field-error" id="add-client-error" role="alert">
        {state.error}
      </p>
    );
  return (
    <SidePanel id="add-client" title="Add a client" close="/app/clients">
      <p className="hint">Only the name is needed. Add the email, PAN and GSTIN if you have them; InboxCA uses them to recognise the client&apos;s emails and documents.</p>
      <form key={JSON.stringify(state.values)} action={add} className="fields" noValidate>
        <div>
          <label htmlFor="client-name">Name</label>
          <input id="client-name" name="name" required defaultValue={state.values?.name} {...mark("name")} />
          {error("name")}
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
          <input id="client-email" name="email" type="email" autoComplete="off" defaultValue={state.values?.email} {...mark("email")} />
          {error("email")}
        </div>
        <div>
          <label htmlFor="client-pan">PAN</label>
          <input id="client-pan" name="pan" autoComplete="off" maxLength={10} className="num" defaultValue={state.values?.pan} {...mark("pan")} />
          {error("pan")}
        </div>
        <div>
          <label htmlFor="client-gstin">GSTIN</label>
          <input id="client-gstin" name="gstin" autoComplete="off" maxLength={15} className="num" defaultValue={state.values?.gstin} {...mark("gstin")} />
          {error("gstin")}
        </div>
        <button className="b b-primary" type="submit" disabled={adding} aria-busy={adding || undefined}>
          {adding ? "Adding" : "Add client"}
        </button>
      </form>
      {state.error && !field && (
        <p className="alert" role="alert">
          {state.error}
        </p>
      )}
    </SidePanel>
  );
}
