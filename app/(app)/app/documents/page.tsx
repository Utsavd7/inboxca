import "./documents.css";
import { FolderOpen, Search, Upload } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { todayInIndia } from "@/src/lib/calendar";
import { serverCrypto } from "@/src/lib/crypto";
import { folderFor, periodChoices, periodName } from "@/src/lib/documents";
import { workTypes, type FolderOrder, type WorkType } from "@/src/lib/drive";
import { currentMember } from "@/src/lib/member";
import { personName } from "@/src/lib/roles";
import { searchTokens, words } from "@/src/lib/search";
import { supabaseAdmin } from "@/src/lib/supabase";
import { AutoSelect } from "../auto-select";
import { FileViewer } from "../files/[id]/view/file-viewer";
import { DroppedNotice, PortalDrop } from "../portal-drop";
import { Badge, Empty, PageHead, SidePanel } from "../ui";
import { RowKeys } from "../row-keys";

const PAGE = 50;
const columns = "id, client_id, name, document_type, work_type, period_key, status, email_event_id, received_at, form:prepared->>form, clients(name), email_events(contact_id, contacts(name_enc)), client_registrations(number_enc)";
const drives: Record<string, string> = { dropbox: "Dropbox", onedrive: "OneDrive" };

// Every paper of the clients this person may see, in the firm's own drive: by financial
// year and work, as the drive files them, 50 at a time. All choices live in the address.
export default async function Documents({ searchParams }: { searchParams: Promise<{ year?: string; kind?: string; q?: string; page?: string; file?: string; upload?: string; for?: string; portal?: string; dropped?: string; error?: string; show?: string }> }) {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const params = await searchParams;
  // Financial years by the key of their last month's year: "2027" is FY 2026-27.
  const years = periodChoices(todayInIndia()).filter((key) => key.length === 4);
  const asked = /^(20\d\d)-(\d\d)$/.exec(params.year ?? "");
  const year = params.year === "all" ? "" : asked && (Number(asked[1]) + 1) % 100 === Number(asked[2]) ? String(Number(asked[1]) + 1) : years[0];
  const kind = params.kind && params.kind in workTypes ? (params.kind as WorkType) : "";
  const q = params.q?.trim().slice(0, 200) ?? "";
  const page = /^\d{1,6}$/.test(params.page ?? "") ? Math.max(1, Number(params.page)) : 1;
  // Today's missing papers line opens only the papers no longer in the drive.
  const missing = params.show === "missing";
  const live = missing ? (["eq", "missing"] as const) : (["not.in", "(deleted,earlier)"] as const);
  const typed = words(q, 8);
  const tokens = typed.length ? await searchTokens(membership.firmId, typed) : null;

  const state = { year: year === years[0] ? "" : year ? `${Number(year) - 1}-${year.slice(2)}` : "all", kind, q, page: page > 1 ? String(page) : "", file: "", upload: "", portal: "", show: missing ? "missing" : "" };
  const link = (next: Partial<typeof state>) => {
    const search = new URLSearchParams(Object.entries({ ...state, ...next }).filter(([, value]) => value));
    return `/app/documents${search.size ? `?${search}` : ""}`;
  };
  // The year, as the drive files it: by the paper's period, or the month it came in.
  const within = year && `and(period_key.gte.${Number(year) - 1}-04,period_key.lte.${year}-03),and(period_key.eq."",received_at.gte.${Number(year) - 1}-04-01,received_at.lt.${year}-04-01)`;
  const scoped = <Q extends { or: (filters: string) => Q; contains: (column: "search_tokens", value: string[]) => Q }>(query: Q) => {
    if (within) query = query.or(within);
    return tokens ? query.contains("search_tokens", tokens) : query;
  };
  const count = (work?: WorkType) => {
    const query = scoped(supabase.from("documents").select("id", { count: "exact", head: true }).eq("firm_id", membership.firmId).filter("status", live[0], live[1]));
    return work ? query.eq("work_type", work) : query;
  };
  // Earlier versions are listed only in their current paper's panel on the client's page.
  const listed = scoped(supabase.from("documents").select(columns).eq("firm_id", membership.firmId).filter("status", live[0], live[1]));
  const [{ data: papers, error }, all, ...byWork] = await Promise.all([
    (kind ? listed.eq("work_type", kind) : listed).order("received_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1),
    count(),
    ...(Object.keys(workTypes) as WorkType[]).map((work) => count(work)),
  ]);
  if (error) throw new Error("Documents could not be read");
  const counts = new Map((Object.keys(workTypes) as WorkType[]).map((work, at) => [work, byWork[at].count ?? 0]));
  const total = (kind ? counts.get(kind) : all.count) ?? 0;

  // The paper shown on the right: the one chosen, else the first in the list.
  const chosen = params.file && /^[0-9a-f-]{36}$/.test(params.file) ? (await supabase.from("documents").select(columns).eq("firm_id", membership.firmId).eq("id", params.file).neq("status", "deleted").maybeSingle()).data : null;
  const paper = chosen ?? papers?.[0];
  const shown = [...(papers ?? []), ...(chosen ? [chosen] : [])];
  // This same view, with the chosen paper; the upload panel opens and closes over it.
  const here = { page: state.page, file: chosen?.id ?? "" };

  // Where each paper came from. Uploads are known from the activity log, which every person
  // who may see the client already sees on its page; only these papers' lines are read.
  const admin = supabaseAdmin();
  const unsent = shown.filter((row) => !row.email_event_id && !row.form).map((row) => row.id);
  const [{ data: added }, { data: drive }] = await Promise.all([
    unsent.length ? admin.from("activity_log").select("entity_id, actor_id").eq("firm_id", membership.firmId).in("action", ["document.uploaded", "document.added"]).in("entity_id", unsent) : Promise.resolve({ data: [] }),
    paper ? admin.from("connected_accounts").select("provider, settings").eq("firm_id", membership.firmId).eq("kind", "drive").maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const adder = new Map((added ?? []).map((line) => [line.entity_id, line.actor_id]));
  const { data: people } = [...adder.values()].some(Boolean) ? await supabase.rpc("firm_people", { target_firm: membership.firmId }) : { data: [] };
  const emails = new Map((people ?? []).map((person) => [person.user_id, person.email]));
  const crypto = serverCrypto();
  const senders = new Map(
    await Promise.all(
      [...new Map(shown.flatMap((row) => (row.email_events?.contacts && row.email_events.contact_id ? [[row.email_events.contact_id, row.email_events.contacts.name_enc] as const] : []))).entries()].map(
        async ([id, name]) => [id, await crypto.decrypt(membership.firmId, `contacts/${id}/name`, name)] as const,
      ),
    ),
  );
  const paperGstin = paper?.client_registrations ? await crypto.decrypt(membership.firmId, `clients/${paper.client_id}/gstin`, paper.client_registrations.number_enc) : "";
  const cameFrom = (row: (typeof shown)[number]) => {
    if (row.email_event_id) return `Email from ${senders.get(row.email_events?.contact_id ?? "") || row.clients?.name || "the client"}`;
    if (row.form) return "Prepared in InboxCA";
    if (!adder.has(row.id)) return "Brought in from the drive";
    const by = adder.get(row.id);
    if (!by) return "Client upload link";
    return `${row.work_type === "gst" && /^GSTR-2[AB]$/.test(row.document_type) && /\.json$/i.test(row.name) ? "Portal file, added" : "Uploaded"} by ${personName(emails.get(by))}`;
  };

  const order = ((drive?.settings as { folder_order?: FolderOrder } | null)?.folder_order ?? "year_client_work") as FolderOrder;
  const path = paper && [drives[drive?.provider ?? ""], "InboxCA", ...folderFor(order, paper.clients?.name ?? "", { work: paper.work_type as WorkType, period: paper.period_key, receivedAt: paper.received_at, toCheck: paper.status === "to_check" }), paper.name].filter(Boolean).join(" / ");
  const extension = paper?.name.split(".").pop()?.toLowerCase() ?? "";
  const viewable = ["pdf", "png", "jpg", "jpeg", "gif", "webp", "xlsx", "xls", "csv", "json", "txt"].includes(extension);
  const tag = (status: string) => (status === "to_check" ? <Badge tone="warn">To check</Badge> : status === "missing" ? <Badge tone="late">Missing in the drive</Badge> : null);
  const canUpload = !membership.viewOnlyUntil;
  const portal = membership.may("portal_files");
  const filtered = !!(q || kind || year !== years[0] || missing);

  // Upload papers: find the client, then their upload form opens with type, work and period.
  const find = params.upload ? params.for?.trim().slice(0, 100) ?? "" : "";
  const { data: matches } = find ? await supabase.from("clients").select("id, name").eq("firm_id", membership.firmId).is("archived_at", null).ilike("name", `%${find.replace(/[\\%_]/g, "\\$&")}%`).order("name").limit(8) : { data: null };

  return (
    <div className="fill docs">
      <PageHead
        title="Documents"
        sub="Every client paper, kept in your firm's own drive and filed by year, client and work."
        actions={
          <>
            {portal && (
              <Link className="b b-secondary" href={link({ ...here, portal: "1" })} scroll={false}>
                Add portal files
              </Link>
            )}
            {canUpload && (
              <Link className="b b-primary" href={link({ ...here, upload: "1" })} scroll={false}>
                <Upload size={16} aria-hidden />
                Upload papers
              </Link>
            )}
          </>
        }
      />
      <DroppedNotice value={params.dropped} />
      {params.error === "drive" && (
        <p className="alert" role="alert">
          Connect the firm&apos;s drive in Settings first; portal files are saved there.
        </p>
      )}
      <div className="split">
        <nav className="pane docs-folders" aria-label="Folders">
          <form className="docs-year">
            {state.kind && <input type="hidden" name="kind" value={state.kind} />}
            {q && <input type="hidden" name="q" value={q} />}
            <AutoSelect save="year" name="year" defaultValue={state.year || `${Number(years[0]) - 1}-${years[0].slice(2)}`} aria-label="Financial year">
              {[...new Set([...years, ...(year ? [year] : [])])].map((key) => (
                <option key={key} value={`${Number(key) - 1}-${key.slice(2)}`}>
                  {periodName(key)}
                </option>
              ))}
              <option value="all">All years</option>
            </AutoSelect>
            <button className="sr-only" value="year">
              Show
            </button>
          </form>
          {([["", "All papers", all.count ?? 0], ...[...counts].map(([work, n]) => [work, workTypes[work], n])] as [string, string, number][]).map(([work, name, n]) => (
            <Link key={work} className="docs-folder" href={link({ kind: work as WorkType | "", page: "" })} aria-current={kind === work ? "page" : undefined}>
              <FolderOpen size={16} aria-hidden />
              <span>{name}</span>
              <span className="docs-n">{n.toLocaleString("en-IN")}</span>
            </Link>
          ))}
        </nav>

        <section className="docs-list" aria-label="Papers">
          <form className="docs-find" role="search">
            {state.year && <input type="hidden" name="year" value={state.year} />}
            {kind && <input type="hidden" name="kind" value={kind} />}
            <Search size={16} aria-hidden />
            {missing && <input type="hidden" name="show" value="missing" />}
            <input name="q" type="search" defaultValue={q} placeholder="Find a paper by its name or words inside it" aria-label="Find papers" />
          </form>
          {missing && (
            <p className="docs-only">
              <Badge tone="late">Missing in the drive</Badge>
              <span>Only papers no longer in your drive. Put each file back in its folder, or remove the paper on its client&apos;s Documents.</span>
              <Link className="b b-secondary" href={link({ show: "", page: "" })}>
                Show all papers
              </Link>
            </p>
          )}
          {papers?.length ? (
            <>
              <div className="pane docs-table">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Paper</th>
                      <th scope="col">Client</th>
                      <th scope="col">Period</th>
                      <th scope="col">Came from</th>
                    </tr>
                  </thead>
                  <tbody>
                    {papers.map((row) => (
                      <tr key={row.id} className={row.id === paper?.id ? "on" : undefined}>
                        <td>
                          <Link className="docs-name" href={link({ page: state.page, file: row.id })} scroll={false} title={row.name} aria-current={row.id === paper?.id ? "true" : undefined}>
                            {/* The Client column already names the client, so its name is not repeated here. */}
                            {row.clients?.name && row.name.startsWith(`${row.clients.name} - `) ? row.name.slice(row.clients.name.length + 3) : row.name}
                          </Link>
                          <span className="docs-tag">
                            {workTypes[row.work_type as WorkType]}
                            {tag(row.status)}
                          </span>
                        </td>
                        <td>{row.clients?.name}</td>
                        <td>{periodName(row.period_key) || <span className="docs-faint">No period</span>}</td>
                        <td className="docs-faint">{cameFrom(row)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <RowKeys />
              </div>
              <div className="docs-pages">
                <span>
                  {((page - 1) * PAGE + 1).toLocaleString("en-IN")} to {((page - 1) * PAGE + papers.length).toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
                </span>
                {page > 1 && (
                  <Link className="b b-secondary" href={link({ page: String(page - 1) })}>
                    Previous
                  </Link>
                )}
                {page * PAGE < total && (
                  <Link className="b b-secondary" href={link({ page: String(page + 1) })}>
                    Next
                  </Link>
                )}
              </div>
            </>
          ) : filtered ? (
            <Empty Icon={FolderOpen} title="No papers match">
              <span>Try All papers, another year, or other words.</span>
              <Link className="b b-secondary" href="/app/documents?year=all">
                Show every paper
              </Link>
            </Empty>
          ) : (
            <Empty Icon={FolderOpen} title="No papers yet">
              <span>Papers your clients email are filed here once the email and the drive are connected. Upload papers to add one now.</span>
              {canUpload && (
                <Link className="b b-primary" href="/app/documents?upload=1" scroll={false}>
                  Upload papers
                </Link>
              )}
            </Empty>
          )}
        </section>

        {paper && (
          <aside key={paper.id} className="pane pane-in docs-detail" aria-label="Paper">
            <div className="docs-preview">
              {!viewable ? (
                <span>This kind of file cannot be shown here.</span>
              ) : !process.env.FILE_WORKER_URL || !process.env.FILE_WORKER_SECRET ? (
                <span>Papers cannot be shown yet.</span>
              ) : (
                // The paper first in the list shows its first page as a thumbnail, logged as a
                // thumbnail view; choosing a paper opens it, logged as viewed.
                <FileViewer id={paper.id} page={1} thumb={!chosen} hideInactive={membership.settings.viewer_hide_inactive === true} />
              )}
            </div>
            <h2>{paper.name}</h2>
            <p className="docs-faint">
              {[paper.document_type, workTypes[paper.work_type as WorkType], periodName(paper.period_key)].filter(Boolean).join(", ")} {tag(paper.status)}
            </p>
            <p className="docs-path">{path}</p>
            <p>
              <span className="docs-label">Came from</span>
              {cameFrom(paper)}
            </p>
            {paperGstin && (
              <p>
                <span className="docs-label">GSTIN</span>
                <span className="num">{paperGstin}</span>
              </p>
            )}
            <div className="docs-actions">
              <Link className="b b-secondary" href={`/app/files/${paper.id}/view`}>
                View
              </Link>
              {membership.role === "owner" && !paper.form && (
                <a className="b b-secondary" href={`/app/files/${paper.id}`}>
                  Download
                </a>
              )}
              <Link className="b b-secondary" href={`/app/clients/${paper.client_id}`}>
                Open client
              </Link>
            </div>
          </aside>
        )}
      </div>

      {params.upload && canUpload && (
        <>
          <Link className="docs-shade" href={link(here)} scroll={false} aria-label="Close" />
          <aside className="panel-in docs-sheet" aria-labelledby="upload-papers">
            <h2 id="upload-papers">Upload papers</h2>
            <p className="docs-faint">Choose the client. Their upload form opens, where you pick the paper&apos;s type, work and period.</p>
            <form className="docs-find" role="search">
              {Object.entries({ ...state, ...here, upload: "1" }).map(([name, value]) => value && <input key={name} type="hidden" name={name} value={value} />)}
              <Search size={16} aria-hidden />
              <input name="for" type="search" defaultValue={find} placeholder="Client name" aria-label="Client name" autoFocus />
            </form>
            {matches && (matches.length ? (
              <ul className="docs-clients">
                {matches.map((client) => (
                  <li key={client.id}>
                    <span>{client.name}</span>
                    <Link className="b b-secondary" href={`/app/clients/${client.id}?tab=files&upload=1`}>
                      Choose
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="docs-faint">No client by that name. Try part of the name.</p>
            ))}
            <Link className="b b-secondary" href={link(here)} scroll={false}>
              Close
            </Link>
          </aside>
        </>
      )}
      {params.portal && portal && (
        <SidePanel id="portal-panel"title="Files from the GST portal" close={link(here)}>
          <PortalDrop back="/app/documents" />
        </SidePanel>
      )}
    </div>
  );
}
