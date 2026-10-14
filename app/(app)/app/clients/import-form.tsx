"use client";
import { useActionState } from "react";
import { importClients, type ImportState } from "@/app/(app)/actions";

// Import clients from a spreadsheet: choose a file, see every row's problem, then add the
// good rows in one go.
export function ImportForm() {
  const [state, run, running] = useActionState(importClients, {} as ImportState);
  const problems = state.rows?.filter((row) => row.error) ?? [];
  const ready = (state.rows?.length ?? 0) - problems.length;

  return (
    <section className="app-card" aria-labelledby="import">
      <h2 id="import">Import from Excel or CSV</h2>
      {state.done ? (
        <p className="app-done" role="status">
          Imported {state.done} clients.
        </p>
      ) : null}
      {state.rows ? (
        <>
          <p className="app-note" role="status">
            {ready} ready to import{problems.length ? `, ${problems.length} with a problem and left out` : ""}.
          </p>
          {!!problems.length && (
            <div className="table-scroll">
              <table className="app-table">
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
          <form action={run} className="app-form-row">
            <input type="hidden" name="rows" value={JSON.stringify(state.rows)} />
            <button className="btn" type="submit" disabled={running || !ready}>
              {running ? "Importing" : `Import ${ready} clients`}
            </button>
            <button className="btn btn-quiet" type="button" onClick={() => window.location.reload()}>
              Choose another file
            </button>
          </form>
        </>
      ) : (
        <form action={run} className="app-form-row">
          <div>
            <label htmlFor="import-file">CSV or Excel file</label>
            <input id="import-file" name="file" type="file" accept=".csv,.xlsx" required />
          </div>
          <button className="btn btn-quiet" type="submit" disabled={running}>
            {running ? "Reading" : "Check the file"}
          </button>
          <p className="app-note">
            The first row names the columns: Name, and Kind, PAN and GSTIN when you have them. Nothing is added
            until you see the check.
          </p>
        </form>
      )}
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
    </section>
  );
}
