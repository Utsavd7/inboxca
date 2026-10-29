import "./import.css";
import { FolderInput } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { startImport, undoFirstImport } from "@/app/(app)/actions";
import { todayInIndia } from "@/src/lib/calendar";
import { periodName, receivedLabel } from "@/src/lib/documents";
import { financialYear, INCOMING, workTypes, type WorkType } from "@/src/lib/drive";
import { openDrive } from "@/src/lib/drive-account";
import { activeClients, importSince, inScope, planImport, type Scope } from "@/src/lib/first-import";
import type { ImportPlan } from "@/src/jobs/import-files";
import { currentMember } from "@/src/lib/member";
import { supabaseAdmin } from "@/src/lib/supabase";
import { Presence } from "../motion";
import { Pending } from "../pending";
import { Badge, Empty, PageHead, SidePanel, Toast } from "../ui";
import { DiskUpload } from "./disk-upload";

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
// The address keeps every choice: folder (several), scope, year, error, started, undoing,
// map:<folder> (the client chosen for a folder), and pick, cq, cpage for the client picker.
export default async function FirstImport({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, membership } = await currentMember();
  if (membership?.role !== "owner") redirect("/app");
  const params = await searchParams;
  const admin = supabaseAdmin();
  const [{ data: account }, clients, { data: imports }, { data: firm }] = await Promise.all([
    admin.from("connected_accounts").select("id, provider, credentials_enc").eq("firm_id", membership.firmId).eq("kind", "drive").maybeSingle(),
    activeClients(supabase),
    admin.from("requests").select("id, status, details").eq("firm_id", membership.firmId).eq("kind", "import").order("id"),
    admin.from("firms").select("created_at").eq("id", membership.firmId).single(),
  ]);
  const drive = account && (await openDrive(membership.firmId, account));
  const folders = drive ? await drive.folders() : [];
  const ticked = [params.folder ?? []].flat().filter((folder) => folders.includes(folder));
  const scope = (typeof params.scope === "string" && params.scope in scopes ? params.scope : "final") as Scope;
  const today = todayInIndia();
  const years = Array.from({ length: 6 }, (_, back) => financialYear(`${Number(today.slice(0, 4)) - back}-${today.slice(5, 7)}`));
  const year = typeof params.year === "string" && years.includes(params.year) ? params.year : years[1];
  const since = importSince(firm?.created_at ?? "", today);
  const name = new Map(clients.map((client) => [client.id, client.name]));
  const chosen = Object.fromEntries(Object.entries(params).flatMap(([key, value]) => (key.startsWith("map:") && typeof value === "string" && name.has(value) ? [[key.slice(4), value]] : [])));
  const listed = drive && ticked.length ? (await Promise.all(ticked.map((folder) => drive.files(folder)))).flat() : [];
  const everything = planImport(listed, clients, "all", year, today, chosen, since);
  const planned = everything.filter((file) => inScope(file, scope, year));
  const unmatched = [...new Set(planned.filter((file) => !file.client || chosen[file.folder]).map((file) => file.folder))];
  const total = planned.reduce((sum, file) => sum + file.size, 0);
  // The picker for one folder's client: a search over the firm's clients, eight a page.
  const address = (next: Record<string, string | undefined>) => {
    const search = new URLSearchParams([...ticked.map((folder) => ["folder", folder]), ["scope", scope], ["year", year]]);
    for (const [key, value] of Object.entries({ ...Object.fromEntries(Object.entries(chosen).map(([folder, id]) => [`map:${folder}`, id])), ...next })) if (value) search.set(key, value);
    return `/app/import?${search}`;
  };
  const pick = typeof params.pick === "string" && unmatched.includes(params.pick) ? params.pick : "";
  const cq = typeof params.cq === "string" ? params.cq.trim().slice(0, 80) : "";
  const cpage = Math.min(Math.max(0, Number(params.cpage) || 0), 1250);
  const found = pick ? clients.filter((client) => client.name.toLowerCase().includes(cq.toLowerCase())).slice(cpage * 8, cpage * 8 + 9) : [];

  return (
    <>
      <PageHead title="Add old files" sub="Optional: move old drive files into each client's folder." />
      {typeof params.error === "string" && errors[params.error] && (
        <p className="alert" role="alert">
          {errors[params.error]}
        </p>
      )}
      {since && (
        <p className="note" role="status">
          In your first 14 days, InboxCA adds only files from {periodName(since)} onwards. You can add older files from {receivedLabel(new Date(Date.parse(firm?.created_at ?? "") + 14 * 86_400_000).toISOString())}.
        </p>
      )}
      {params.started && <Toast>Moving your files now. Each lands in its client&apos;s folder; this page shows the progress.</Toast>}
      {params.undoing && <Toast>Putting the files back where they were.</Toast>}
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
            <Form action="/app/import" className="import-choose">
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
                {Object.entries(scopes).map(([value, label]) => {
                  const files = everything.filter((file) => inScope(file, value as Scope, year));
                  return (
                    <label key={value} className="check">
                      <input type="radio" name="scope" value={value} defaultChecked={scope === value} />
                      {label}
                      {!!ticked.length && <span className="hint">{files.length ? `${files.length} ${files.length === 1 ? "file" : "files"}, ${size(files.reduce((sum, file) => sum + file.size, 0))}` : "No files"}</span>}
                    </label>
                  );
                })}
                <label htmlFor="import-year">Year (only for One year in full)</label>
                <select id="import-year" name="year" defaultValue={year}>
                  {years.map((choice) => (
                    <option key={choice}>{choice}</option>
                  ))}
                </select>
              </fieldset>
              <button className="b b-secondary" type="submit">
                Show what would move
              </button>
            </Form>
          </section>
          <DiskUpload incoming={folders.find((folder) => folder.endsWith(`InboxCA/${INCOMING}`))} onedrive={account?.provider === "onedrive"} />

          {!!ticked.length && (
            <section className="panel" aria-labelledby="preview">
              <div className="panel-head">
                <h2 id="preview">
                  {planned.length} {planned.length === 1 ? "file" : "files"}, {size(total)}
                </h2>
                <p className="hint">Nothing moves until you choose to move the files. They stay in your drive, so nothing is uploaded again.</p>
              </div>
              <form action={startImport}>
                {ticked.map((folder) => (
                  <input key={folder} type="hidden" name="folder" value={folder} />
                ))}
                <input type="hidden" name="scope" value={scope} />
                <input type="hidden" name="year" value={year} />
                {Object.entries(chosen).map(([folder, id]) => (
                  <input key={folder} type="hidden" name={`map:${folder}`} value={id} />
                ))}
                {!!unmatched.length && (
                  <div className="import-unmatched">
                    <h3 className="sub-head">Folders with no client found</h3>
                    {unmatched.map((folder) => (
                      <div key={folder} className="import-map">
                        <span className="num">{folder}</span>
                        <span>{chosen[folder] ? name.get(chosen[folder]) : "Left where they are"}</span>
                        <Link className="b b-secondary b-small" href={address({ pick: folder })} scroll={false} aria-label={`Choose the client for ${folder}`}>
                          Choose client
                        </Link>
                      </div>
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
                <Pending className="b b-primary import-go" type="submit" disabled={!planned.length}>
                  Move these files
                </Pending>
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
                        <span className="sub">{request.status === "pending" ? "Moving now" : plan.moved.length ? "Finished" : "Moved back"}</span>
                      </span>
                      {!!plan.moved.length && (
                        <form action={undoFirstImport}>
                          <input type="hidden" name="import" value={request.id} />
                          <Pending className="b b-ghost b-small">Undo the move</Pending>
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
      <Presence>
      {pick && (
        <SidePanel key="pick" id="pick-client" title="Choose the client" close={address({})}>
          <p className="hint num">{pick}</p>
          <Form action="/app/import" scroll={false} role="search" className="import-find">
            {[...new URLSearchParams(address({ pick }).split("?")[1]).entries()].map(([key, value], at) => (
              <input key={at} type="hidden" name={key} value={value} />
            ))}
            <input type="search" name="cq" defaultValue={cq} placeholder="Find a client" aria-label="Find a client" autoFocus />
          </Form>
          <ul className="rows">
            {found.slice(0, 8).map((client) => (
              <li key={client.id}>
                <span className="grow name">{client.name}</span>
                <Link className="b b-secondary b-small" href={address({ [`map:${pick}`]: client.id })} aria-label={`Choose ${client.name}`}>
                  Choose
                </Link>
              </li>
            ))}
          </ul>
          {!found.length && <p className="hint">No client by that name. Try part of the name.</p>}
          <p className="import-more">
            {found.length > 8 && <Link href={address({ pick, cq: cq || undefined, cpage: String(cpage + 1) })}>More clients</Link>}
            {chosen[pick] && <Link href={address({ [`map:${pick}`]: undefined })}>Leave these files where they are</Link>}
          </p>
        </SidePanel>
      )}
      </Presence>
    </>
  );
}
