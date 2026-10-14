"use client";
import { useActionState } from "react";
import { addClient, type ClientState } from "@/app/(app)/actions";
import { clientKinds } from "@/src/lib/clients";

export function AddClientForm() {
  const [state, add, adding] = useActionState(addClient, {} as ClientState);
  return (
    <section className="app-card" aria-labelledby="add-client">
      <h2 id="add-client">Add a client</h2>
      <form key={JSON.stringify(state.values)} action={add} className="app-form-row" noValidate>
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
          <label htmlFor="client-pan">PAN</label>
          <input id="client-pan" name="pan" autoComplete="off" maxLength={10} className="num" defaultValue={state.values?.pan} />
        </div>
        <div>
          <label htmlFor="client-gstin">GSTIN, if any</label>
          <input id="client-gstin" name="gstin" autoComplete="off" maxLength={15} className="num" defaultValue={state.values?.gstin} />
        </div>
        <button className="btn" type="submit" disabled={adding}>
          {adding ? "Adding" : "Add client"}
        </button>
      </form>
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
    </section>
  );
}
