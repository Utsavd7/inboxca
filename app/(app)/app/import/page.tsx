import { FolderInput } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { startImport, undoFirstImport } from "@/app/(app)/actions";
import { todayInIndia } from "@/src/lib/calendar";
import { periodName } from "@/src/lib/documents";
import { financialYear, workTypes, type WorkType } from "@/src/lib/drive";
import { openDrive } from "@/src/lib/drive-account";
import { planImport, type Scope } from "@/src/lib/first-import";
import type { ImportPlan } from "@/src/jobs/import-files";
import { currentMember } from "@/src/lib/member";
import { supabaseAdmin } from "@/src/lib/supabase";
import { Badge, Empty, PageHead } from "../ui";

const scopes: Record<Scope, string> = {
  final: "Final papers only: filed returns, acknowledgements, certificates, audit reports, notices and orders (recommended)",
  year: "One year in full",
  all: "Everything in these folders",
};
const errors: Record<string, string> = {
  drive: "Connect the firm's drive in Settings first.",
  none: "No file in those folders has a client yet. Choose the client for each folder below.",
};
const size = (bytes: number) => (bytes < 1024 ** 3 ? `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB` : `${(bytes / 1024 ** 3).toFixed(1)} GB`);

// Add old files (PLAN.md 5.16), the owner's: past files already in the firm's drive are
// moved into their client folders in place, after a preview, and can be put back. Old
// files are optional; InboxCA works on new files from the first day.
export default async function FirstImport({ searchParams }: { searchParams: Promise<{ folder?: string | string[]; scope?: string; year?: string; error?: string; started?: string; undoing?: string }> }) {
  const { supabase, membership } = await currentMember();
  if (membership?.role !== "owner") redirect("/app");
  const params = await searchParams;
  const admin = supabaseAdmin();
  const [{ data: account }, { data: clients }, { data: imports }] = await Promise.all([
    admin.from("connected_accounts").select("id, provider, credentials_enc").eq("firm_id", membership.firmId).eq("kind", "drive").maybeSingle(),
    supabase.from("clients").select("id, name").is("archived_at", null).order("name"),
    admin.from("requests").select("id, status, details").eq("firm_id", membership.firmId).eq("kind", "import").order("id"),
  ]);
  const drive = account && (await openDrive(membership.firmId, account));
  const folders = drive ? await drive.folders() : [];
  const ticked = [params.folder ?? []].flat().filter((folder) => folders.includes(folder));
  const scope = (params.scope && params.scope in scopes ? params.scope : "final") as Scope;
  const today = todayInIndia();
  const years = Array.from({ length: 6 }, (_, back) => financialYear(`${Number(today.slice(0, 4)) - back}-${today.slice(5, 7)}`));
  const year = params.year && years.includes(params.year) ? params.year : years[1];
  const listed = drive && ticked.length ? (await Promise.all(ticked.map((folder) => drive.files(folder)))).flat() : [];
  const planned = planImport(listed, clients ?? [], scope, year, today);
  const unmatched = [...new Set(planned.filter((file) => !file.client).map((file) => file.folder))];
  const name = new Map(clients?.map((client) => [client.id, client.name]));
  const total = planned.reduce((sum, file) => sum + file.size, 0);

  return (
    <>
      <PageHead title="Add old files" sub="Optional. InboxCA works on new files from day one. Past files already in your drive can be sorted into their client folders here, in place." />
      {params.error && errors[params.error] && (
        <p className="alert" role="alert">
          {errors[params.error]}
        </p>
      )}
      {params.started && (
        <p className="notice" role="status">
          Moving your files now. Each lands in its client&apos;s folder; this page shows the progress.
        </p>
      )}
      {params.undoing && (
        <p className="notice" role="status">
          Putting the files back where they were.
        </p>
      )}
      {!drive ? (
        <Empty Icon={FolderInput} title="No drive connected">
          <span>
            <Link href="/app/settings#drive">Connect the firm&apos;s drive</Link> first. Files on a hard disk are best copied into the drive with its own desktop app.
          </span>
        </Empty>
      ) : (
        <>
          <section className="panel" aria-labelledby="choose">
            <h2 id="choose">What to bring</h2>
            <form className="import-choose">
              <fieldset>
                <legend>Folders in your drive</legend>
                {folders.map((folder) => (
                  <label key={folder} className="check">
                    <input type="checkbox" name="folder" value={folder} defaultChecked={ticked.includes(folder)} />
                    {folder}
                  </label>
                ))}
                {!folders.length && <p className="hint">Your drive has no folders besides InboxCA&apos;s own.</p>}
              </fieldset>
              <fieldset>
                <legend>Which files</legend>
                {Object.entries(scopes).map(([value, label]) => (
                  <label key={value} className="check">
                    <input type="radio" name="scope" value={value} defaultChecked={scope === value} />
                    {label}
                  </label>
                ))}
                <label htmlFor="import-year">The year, for one year in full</label>
                <select id="import-year" name="year" defaultValue={year}>
                  {years.map((choice) => (
                    <option key={choice}>{choice}</option>
                  ))}
                </select>
              </fieldset>
              <button className="b b-secondary" type="submit">
                Show what would move
              </button>
            </form>
          </section>

          {!!ticked.length && (
            <section className="panel" aria-labelledby="preview">
              <div className="panel-head">
                <h2 id="preview">
                  {planned.length} {planned.length === 1 ? "file" : "files"}, {size(total)}
                </h2>
                <p className="hint">Nothing moves until you approve. Moving inside your drive uploads nothing again.</p>
              </div>
              <form action={startImport}>
                {ticked.map((folder) => (
                  <input key={folder} type="hidden" name="folder" value={folder} />
                ))}
                <input type="hidden" name="scope" value={scope} />
                <input type="hidden" name="year" value={year} />
                {!!unmatched.length && (
                  <div className="import-unmatched">
                    <h3 className="sub-head">Folders with no client found</h3>
                    {unmatched.map((folder) => (
                      <label key={folder} className="import-map">
                        <span className="num">{folder}</span>
                        <select name={`map:${folder}`} defaultValue="">
                          <option value="">Leave these files where they are</option>
                          {clients?.map((client) => (
                            <option key={client.id} value={client.id}>
                              {client.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                )}
                <div className="table-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th scope="col">Now in your drive</th>
                        <th scope="col">Client</th>
                        <th scope="col">Goes in as</th>
                      </tr>
                    </thead>
                    <tbody>
                      {planned.slice(0, 200).map((file) => (
                        <tr key={file.id}>
                          <td className="hint">{file.from}</td>
                          <td>{file.client ? name.get(file.client) : <Badge tone="warn">Choose above</Badge>}</td>
                          <td>
                            {[file.type, periodName(file.period), workTypes[file.work as WorkType]].filter(Boolean).join(", ")}
                            {file.toCheck && <Badge tone="warn">To check</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {planned.length > 200 && <p className="hint">And {planned.length - 200} more.</p>}
                <button className="b b-primary import-go" type="submit" disabled={!planned.length}>
                  Move these files
                </button>
              </form>
            </section>
          )}

          {!!imports?.length && (
            <section className="panel" aria-labelledby="imports">
              <h2 id="imports">Imports</h2>
              <ul className="rows">
                {imports.map((request) => {
                  const plan = request.details as unknown as ImportPlan;
                  return (
                    <li key={request.id}>
                      <span className="grow">
                        <span className="name">
                          {plan.moved.length} of {plan.files.length} files moved
                        </span>
                        <span className="sub">{request.status === "pending" ? "Moving now" : plan.moved.length ? "Finished" : "Put back"}</span>
                      </span>
                      {!!plan.moved.length && (
                        <form action={undoFirstImport}>
                          <input type="hidden" name="import" value={request.id} />
                          <button className="b b-ghost b-small">Put them back</button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
