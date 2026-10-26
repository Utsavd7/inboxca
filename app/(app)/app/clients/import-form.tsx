"use client";
import { useActionState } from "react";
import { importClients, type ImportState } from "@/app/(app)/actions";
import { clientKinds, type ClientKind } from "@/src/lib/clients";
import { SidePanel, Toast } from "../ui";

// Import clients from a spreadsheet: choose a file, see every row's problem, then add the
// good rows in one go.
export function ImportForm() {
  const [state, run, running] = useActionState(importClients, {} as ImportState);
  const problems = state.rows?.filter((row) => row.error) ?? [];
  const ready = (state.rows?.length ?? 0) - problems.length;
  const first = state.rows?.filter((row) => !row.error).slice(0, 5) ?? [];

  return (
    <SidePanel id="import" title="Import from Excel or CSV" close="/app/clients">
      {state.done ? <Toast>Imported {state.done} {state.done === 1 ? "client" : "clients"}.</Toast> : null}
      {state.rows ? (
        <>
          <p className="hint" role="status">
            {ready} ready to import{problems.length ? `, ${problems.length} with a problem and left out` : ""}.
          </p>
          {!!first.length && (
            <>
              <h3>How the first rows will be saved</h3>
              <div className="table-wrap">
                <table className="t">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Client type</th>
                      <th scope="col">Email</th>
                      <th scope="col">PAN</th>
                      <th scope="col">GSTIN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {first.map((row) => (
                      <tr key={row.line}>
                        <td>{row.name}</td>
                        <td>{clientKinds[row.kind as ClientKind]}</td>
                        <td>{row.email}</td>
                        <td className="num">{row.pan}</td>
                        <td className="num">{row.gstin}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {!!problems.length && (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    <th scope="col">Name</th>
                    <th scope="col">Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {problems.map((row) => (
                    <tr key={row.line}>
                      <td className="num">{row.line}</td>
                      <td>{row.name || "(no name)"}</td>
                      <td>{row.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <form action={run} className="form-row">
            <input type="hidden" name="rows" value={JSON.stringify(state.rows)} />
            <button className="b b-primary" type="submit" disabled={running || !ready} aria-busy={running || undefined}>
              {running ? "Importing" : `Import ${ready} ${ready === 1 ? "client" : "clients"}`}
            </button>
            <button className="b b-secondary" type="button" onClick={() => window.location.reload()}>
              Choose another file
            </button>
          </form>
        </>
      ) : (
        <form action={run} className="form-row">
          <div>
            <label htmlFor="import-file">CSV or Excel file</label>
            <input id="import-file" name="file" type="file" accept=".csv,.xlsx" required />
          </div>
          <button className="b b-secondary" type="submit" disabled={running} aria-busy={running || undefined}>
            {running ? "Reading" : "Check the file"}
          </button>
          <p className="hint">
            Row 1 must hold the column names: Name, and if you have them, Client type, Email, PAN and GSTIN. InboxCA
            adds nothing until you have seen the check.
          </p>
          <a className="hint" href="/clients-sample.csv" download>
            Download a sample sheet
          </a>
        </form>
      )}
      {state.error && (
        <p className="alert" role="alert">
          {state.error}
        </p>
      )}
    </SidePanel>
  );
}
