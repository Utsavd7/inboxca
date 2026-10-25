import "./documents.css";
import "../clients/clients.css";
import { Download, FolderOpen, Search, Send, Upload } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { sendPapers } from "@/app/(app)/actions";
import { todayInIndia } from "@/src/lib/calendar";
import { canManageClients } from "@/src/lib/clients";
import { serverCrypto } from "@/src/lib/crypto";
import { documentTypes, folderFor, periodChoices, periodName, workOfType } from "@/src/lib/documents";
import { workTypes, type FolderOrder, type WorkType } from "@/src/lib/drive";
import { currentMember } from "@/src/lib/member";
import { paperPolicy, type RecordsSettings } from "@/src/lib/records";
import { personName } from "@/src/lib/roles";
import { searchTokens, words } from "@/src/lib/search";
import { supabaseAdmin } from "@/src/lib/supabase";
import { AutoSelect } from "../auto-select";
import { UploadForm } from "../clients/[id]/upload-form";
import { FileViewer } from "../files/[id]/view/file-viewer";
import { Pending } from "../pending";
import { DroppedNotice, PortalDrop } from "../portal-drop";
import { Avatar, Badge, Empty, PageHead, Row, SidePanel, Toast } from "../ui";
import { CopyButton } from "../ui-client";
import { RowKeys } from "../row-keys";
import { DropUpload, HeldFiles } from "./drop-upload";
import { FileTile } from "./file-tile";
import { FoldersView, ViewSwitch } from "./folders/view";

const PAGE = 50;
const columns = "id, client_id, name, document_type, work_type, period_key, status, email_event_id, received_at, form:prepared->>form, clients(name), email_events(contact_id, contacts(name_enc)), client_registrations(number_enc)";
const drives: Record<string, string> = { dropbox: "Dropbox", onedrive: "OneDrive" };
const uuid = /^[0-9a-f-]{36}$/;
// At most this many papers go out as secure links from one Send.
const SEND = 20;

// Every paper of the clients this person may see, in the firm's own drive: by financial
// year and work, as the drive files them, 50 at a time. All choices live in the address.
export default async function Documents({ searchParams }: { searchParams: Promise<{ year?: string; kind?: string; q?: string; page?: string; file?: string; upload?: string; for?: string; client?: string; portal?: string; dropped?: string; error?: string; show?: string; pick?: string | string[]; send?: string; sent?: string; view?: string; path?: string }> }) {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const params = await searchParams;
  if (params.view === "folders") return <FoldersView path={params.path} />;
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

  const state = { year: year === years[0] ? "" : year ? `${Number(year) - 1}-${year.slice(2)}` : "all", kind, q, page: page > 1 ? String(page) : "", file: "", upload: "", client: "", portal: "", show: missing ? "missing" : "" };
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
  // The folders' counts come in after the list, so the papers show without waiting for them.
  const count = (work?: WorkType) => {
    const query = scoped(supabase.from("documents").select("id", { count: "exact", head: true }).eq("firm_id", membership.firmId).filter("status", live[0], live[1]));
    return Promise.resolve(work ? query.eq("work_type", work) : query).then(({ count }) => count ?? 0);
  };
  const counts = new Map<WorkType | "", Promise<number>>([["", count()], ...(Object.keys(workTypes) as WorkType[]).map((work) => [work, count(work)] as const)]);
  const canUpload = !membership.viewOnlyUntil;
  // Upload papers: find the client, then their upload form opens here with type, work and period.
  const find = params.upload ? params.for?.trim().slice(0, 100) ?? "" : "";
  const askedClient = params.upload && uuid.test(params.client ?? "") ? params.client! : "";
  const picked = [params.pick ?? []].flat().filter((id) => uuid.test(id));
  const sendPreview = !!params.send && !!picked.length && !membership.viewOnlyUntil;
  const admin = supabaseAdmin();
  // Earlier versions are listed only in their current paper's panel on the client's page. One
  // more than a page is read, to know whether there is a next page.
  const listed = scoped(supabase.from("documents").select(columns).eq("firm_id", membership.firmId).filter("status", live[0], live[1]));
  const [{ data: read, error }, { data: chosen }, { data: drive }, { data: people }, { data: matches }, { data: uploadClient }, { data: toSend }, { data: mailbox }] = await Promise.all([
    (kind ? listed.eq("work_type", kind) : listed).order("received_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * PAGE, page * PAGE),
    // The paper shown on the right: the one chosen, else the first in the list.
    params.file && uuid.test(params.file) ? supabase.from("documents").select(columns).eq("firm_id", membership.firmId).eq("id", params.file).neq("status", "deleted").maybeSingle() : Promise.resolve({ data: null }),
    admin.from("connected_accounts").select("provider, settings").eq("firm_id", membership.firmId).eq("kind", "drive").maybeSingle(),
    supabase.rpc("firm_people", { target_firm: membership.firmId }),
    find ? supabase.from("clients").select("id, name").eq("firm_id", membership.firmId).is("archived_at", null).ilike("name", `%${find.replace(/[\\%_]/g, "\\$&")}%`).order("name").limit(8) : Promise.resolve({ data: null }),
    askedClient && canUpload ? supabase.from("clients").select("id, name, client_registrations(id, kind, number_enc)").eq("firm_id", membership.firmId).eq("id", askedClient).is("archived_at", null).maybeSingle() : Promise.resolve({ data: null }),
    sendPreview ? supabase.from("documents").select("id, client_id, name, status, share_policy, document_type, clients(name, email_enc)").eq("firm_id", membership.firmId).in("id", picked.slice(0, SEND)) : Promise.resolve({ data: null }),
    sendPreview ? supabase.from("connected_accounts").select("status").eq("firm_id", membership.firmId).eq("kind", "mail").maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (error) throw new Error("Documents could not be read");
  const papers = read?.slice(0, PAGE);
  const more = (read?.length ?? 0) > PAGE;
  const paper = chosen ?? papers?.[0];
  const shown = [...(papers ?? []), ...(chosen ? [chosen] : [])];
  // This same view, with the chosen paper; the upload panel opens and closes over it.
  const here = { page: state.page, file: chosen?.id ?? "" };

  // Where each paper came from. Uploads are known from the activity log, which every person
  // who may see the client already sees on its page; only these papers' lines are read.
  const unsent = shown.filter((row) => !row.email_event_id && !row.form).map((row) => row.id);
  const crypto = serverCrypto();
  const [{ data: added }, sent_by, paperGstin, gstins] = await Promise.all([
    unsent.length ? admin.from("activity_log").select("entity_id, actor_id").eq("firm_id", membership.firmId).in("action", ["document.uploaded", "document.added"]).in("entity_id", unsent) : Promise.resolve({ data: [] }),
    Promise.all(
      [...new Map(shown.flatMap((row) => (row.email_events?.contacts && row.email_events.contact_id ? [[row.email_events.contact_id, row.email_events.contacts.name_enc] as const] : []))).entries()].map(
        async ([id, name]) => [id, await crypto.decrypt(membership.firmId, `contacts/${id}/name`, name)] as const,
      ),
    ),
    paper?.client_registrations ? crypto.decrypt(membership.firmId, `clients/${paper.client_id}/gstin`, paper.client_registrations.number_enc) : "",
    // GST papers of a client with more than one GSTIN name their GSTIN, as on the client's page.
    Promise.all((uploadClient?.client_registrations ?? []).filter((registration) => registration.kind === "gstin").map(async (registration) => ({ id: registration.id, number: await crypto.decrypt(membership.firmId, `clients/${uploadClient!.id}/gstin`, registration.number_enc) }))),
  ]);
  const adder = new Map((added ?? []).map((line) => [line.entity_id, line.actor_id]));
  const emails = new Map((people ?? []).map((person) => [person.user_id, person.email]));
  const senders = new Map(sent_by);
  const cameFrom = (row: (typeof shown)[number]) => {
    if (row.email_event_id) return `Email from ${senders.get(row.email_events?.contact_id ?? "") || row.clients?.name || "the client"}`;
    if (row.form) return "Prepared in InboxCA";
    if (!adder.has(row.id)) return "From the drive";
    const by = adder.get(row.id);
    if (!by) return "Client upload link";
    return `${row.work_type === "gst" && /^GSTR-2[AB]$/.test(row.document_type) && /\.json$/i.test(row.name) ? "Portal file, added" : "Uploaded"} by ${personName(emails.get(by))}`;
  };

  const order = ((drive?.settings as { folder_order?: FolderOrder } | null)?.folder_order ?? "year_client_work") as FolderOrder;
  const path = paper && [drives[drive?.provider ?? ""], "InboxCA", ...folderFor(order, paper.clients?.name ?? "", { work: paper.work_type as WorkType, period: paper.period_key, receivedAt: paper.received_at, toCheck: paper.status === "to_check" }), paper.name].filter(Boolean).join(" / ");
  const extension = paper?.name.split(".").pop()?.toLowerCase() ?? "";
  const viewable = ["pdf", "png", "jpg", "jpeg", "gif", "webp", "xlsx", "xls", "csv", "json", "txt"].includes(extension);
  const tag = (status: string) => (status === "to_check" ? <Badge tone="warn">To check</Badge> : status === "missing" ? <Badge tone="late">Missing in the drive</Badge> : null);
  const portal = membership.may("portal_files");
  const filtered = !!(q || kind || year !== years[0] || missing);

  // Files dropped on the page go to the client being uploaded for, else the open paper's.
  const dropFor = uploadClient ?? (chosen?.clients ? { id: chosen.client_id, name: chosen.clients.name } : null);

  // Ticked papers: the owner downloads them as one ZIP; those who may send email them as links.
  const owner = membership.role === "owner";
  const mayPick = (row: { client_id: string }) => !membership.viewOnlyUntil && (owner || membership.may("send", row.client_id));
  const picking = (papers ?? []).some(mayPick);
  const sendsAny = picking && (papers ?? []).some((row) => membership.may("send", row.client_id));
  const records = (membership.settings.records ?? {}) as RecordsSettings;
  const preview = toSend?.map((row) => ({
    ...row,
    skip: !membership.may("send", row.client_id) ? "Ask the owner to send this" : row.status !== "filed" ? "Not filed yet" : paperPolicy(row, records) === "internal" ? "Kept inside the firm" : !row.clients?.email_enc ? "No email address" : null,
  }));
  const sending = preview?.filter((row) => !row.skip).length ?? 0;
  const [sent, skipped] = (params.sent ?? "").split("-").map(Number);
  const close = link(here);

  return (
    <div className="fill docs has-bulk">
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
      <ViewSwitch folders={false} />
      {canUpload && <DropUpload client={dropFor?.name ?? null} href={link({ ...here, upload: "1", client: dropFor?.id ?? "" })} />}
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
          {[...counts].map(([work, n]) => (
            <Link key={work} className="docs-folder" href={link({ kind: work, page: "" })} aria-current={kind === work ? "page" : undefined}>
              <FolderOpen size={16} aria-hidden />
              <span>{work ? workTypes[work] : "All papers"}</span>
              <span className="docs-n">
                <Suspense fallback={<span className="docs-wait" aria-label="Counting" />}>
                  <Count of={n} />
                </Suspense>
              </span>
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
                      {picking && (
                        <th scope="col" className="docs-pick">
                          <span className="sr-only">Choose</span>
                        </th>
                      )}
                      <th scope="col">Paper</th>
                      <th scope="col">Client</th>
                      <th scope="col">Period</th>
                      <th scope="col">Came from</th>
                    </tr>
                  </thead>
                  <tbody className="stagger">
                    {papers.map((row) => (
                      <tr key={row.id} className={row.id === paper?.id ? "on" : undefined}>
                        {picking && (
                          <td className="docs-pick">{mayPick(row) && <input className="pick" type="checkbox" form="docs-pick" name="pick" value={row.id} aria-label={`Choose ${row.name}`} />}</td>
                        )}
                        <td>
                          <span className="docs-paper">
                            <FileTile name={row.name} />
                            <span className="grow">
                              <Link className="docs-name" href={link({ page: state.page, file: row.id })} scroll={false} title={row.name} aria-current={row.id === paper?.id ? "true" : undefined}>
                                {/* The Client column already names the client, so its name is not repeated here. */}
                                {row.clients?.name && row.name.startsWith(`${row.clients.name} - `) ? row.name.slice(row.clients.name.length + 3) : row.name}
                              </Link>
                              <span className="docs-tag">
                                {workTypes[row.work_type as WorkType]}
                                {tag(row.status)}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td>
                          <span className="who">
                            <Avatar name={row.clients?.name ?? ""} />
                            <span title={row.clients?.name}>{row.clients?.name}</span>
                          </span>
                        </td>
                        <td>{periodName(row.period_key) || <span className="docs-faint">No period</span>}</td>
                        <td className="docs-faint docs-from" title={cameFrom(row)}>{cameFrom(row)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <RowKeys />
              </div>
              <div className="docs-pages">
                <span>
                  {((page - 1) * PAGE + 1).toLocaleString("en-IN")} to {((page - 1) * PAGE + papers.length).toLocaleString("en-IN")} of{" "}
                  <Suspense fallback={<span className="docs-wait" aria-label="Counting" />}>
                    <Count of={counts.get(kind)!} />
                  </Suspense>
                </span>
                {page > 1 && (
                  <Link className="b b-secondary" href={link({ page: String(page - 1) })}>
                    Previous
                  </Link>
                )}
                {more && (
                  <Link className="b b-secondary" href={link({ page: String(page + 1) })}>
                    Next
                  </Link>
                )}
              </div>
            </>
          ) : filtered ? (
            <Empty Icon={FolderOpen} kind="docs" title="No papers match">
              <span>Try All papers, another year, or other words.</span>
              <Link className="b b-secondary" href="/app/documents?year=all">
                Show every paper
              </Link>
            </Empty>
          ) : (
            <Empty Icon={FolderOpen} kind="docs" title="No papers yet">
              <span>Papers your clients email are filed here once the email and the drive are connected. Upload papers, or drop files on this page, to add one now.</span>
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
                <span className="docs-preview-none">
                  <FileTile name={paper.name} />
                  This kind of file cannot be shown here.
                </span>
              ) : !process.env.FILE_WORKER_URL || !process.env.FILE_WORKER_SECRET ? (
                <span className="docs-preview-none">
                  <FileTile name={paper.name} />
                  Papers cannot be shown yet.
                </span>
              ) : (
                // The paper first in the list shows its first page as a thumbnail, logged as a
                // thumbnail view; choosing a paper opens it, logged as viewed.
                <FileViewer id={paper.id} page={1} thumb={!chosen} hideInactive={membership.settings.viewer_hide_inactive === true} />
              )}
            </div>
            <div className="docs-title">
              <FileTile name={paper.name} />
              <span className="grow">
                <h2>{paper.name}</h2>
                <span className="sub">{[paper.document_type, workTypes[paper.work_type as WorkType], periodName(paper.period_key)].filter(Boolean).join(", ")}</span>
              </span>
            </div>
            {tag(paper.status)}
            <dl className="docs-facts">
              <div>
                <dt>Client</dt>
                <dd className="who">
                  <Avatar name={paper.clients?.name ?? ""} />
                  {paper.clients?.name}
                </dd>
              </div>
              <div>
                <dt>Came from</dt>
                <dd>{cameFrom(paper)}</dd>
              </div>
              {paperGstin && (
                <div>
                  <dt>GSTIN</dt>
                  <dd>
                    <span className="num">{paperGstin}</span>
                    <CopyButton text={paperGstin} label="GSTIN" />
                  </dd>
                </div>
              )}
              {path && (
                <div>
                  <dt>In your drive</dt>
                  <dd className="docs-path">
                    <span>{path}</span>
                    <CopyButton text={path} label="Drive path" />
                  </dd>
                </div>
              )}
            </dl>
            <div className="docs-actions">
              <Link className="b b-primary" href={`/app/files/${paper.id}/view`}>
                View
              </Link>
              {owner && !paper.form && (
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

      {picking && (
        <form id="docs-pick" className="bulk" aria-label="Chosen papers">
          {Object.entries({ ...state, ...here }).map(([name, value]) => value && <input key={name} type="hidden" name={name} value={value} />)}
          <span className="bulk-count">chosen</span>
          {owner && (
            <button className="b b-secondary" formAction="/app/files/zip">
              <Download size={16} aria-hidden />
              Download as ZIP
            </button>
          )}
          {sendsAny && (
            <button className="b b-primary" name="send" value="1">
              <Send size={16} aria-hidden />
              Send as secure links
            </button>
          )}
        </form>
      )}

      {params.upload && canUpload && (
        <SidePanel id="upload-papers" title={uploadClient ? `Upload papers for ${uploadClient.name}` : "Upload papers"} close={close}>
          {uploadClient ? (
            <>
              <p className="hint">Each file is saved in the client&apos;s folder in your firm&apos;s drive, named by the type and period you choose.</p>
              <UploadForm
                clientId={uploadClient.id}
                types={[...documentTypes.filter((type) => type !== "Document"), ...((membership.settings.document_types ?? []) as string[])]}
                typeWork={Object.fromEntries(documentTypes.map((type) => [type, workOfType(type)]).filter(([, work]) => work !== "other"))}
                works={Object.entries(workTypes)}
                periods={periodChoices(todayInIndia()).map((choice) => [choice, periodName(choice)])}
                keep={canManageClients(membership.role)}
              >
                {gstins.length > 1 && (
                  <div>
                    <label htmlFor="gstin-for">GSTIN, for GST papers</label>
                    <select id="gstin-for" name="registration" defaultValue="" className="num">
                      <option value="">Choose</option>
                      {gstins.map((registration) => (
                        <option key={registration.id} value={registration.id}>
                          {registration.number}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </UploadForm>
              <Link className="b b-ghost docs-other" href={link({ ...here, upload: "1" })} scroll={false}>
                Choose another client
              </Link>
            </>
          ) : (
            <>
              <HeldFiles />
              <p className="hint">Choose the client. Their upload form opens, where you pick the paper&apos;s type, work and period.</p>
              <Form action="/app/documents" scroll={false} className="docs-find" role="search">
                {Object.entries({ ...state, ...here, upload: "1" }).map(([name, value]) => value && <input key={name} type="hidden" name={name} value={value} />)}
                <Search size={16} aria-hidden />
                <input name="for" type="search" defaultValue={find} placeholder="Client name" aria-label="Client name" autoFocus />
              </Form>
              {matches &&
                (matches.length ? (
                  <ul className="app-rows docs-clients stagger">
                    {matches.map((client) => (
                      <Row
                        key={client.id}
                        lead={<Avatar name={client.name} />}
                        title={client.name}
                        action={
                          <Link className="b b-secondary" href={link({ ...here, upload: "1", client: client.id })} scroll={false} aria-label={`Choose ${client.name}`}>
                            Choose
                          </Link>
                        }
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="hint">No client by that name. Try part of the name.</p>
                ))}
            </>
          )}
        </SidePanel>
      )}
      {params.portal && portal && (
        <SidePanel id="portal-panel" title="Files from the GST portal" close={close}>
          <PortalDrop back="/app/documents" />
        </SidePanel>
      )}
      {preview && (
        <SidePanel id="send-papers" title={`Send ${preview.length === 1 ? "1 paper" : `${preview.length} papers`} as secure links`} close={close}>
          <p className="hint">Each paper goes to its own client&apos;s email from your firm&apos;s address, as a link that works for 7 days and 5 downloads.</p>
          {picked.length > SEND && (
            <p className="alert" role="alert">
              Only the first {SEND} chosen papers can be sent at once.
            </p>
          )}
          {mailbox?.status !== "connected" && (
            <p className="alert" role="alert">
              Connect the firm&apos;s email in Settings first. Papers go from the firm&apos;s own address.
            </p>
          )}
          <ul className="app-rows docs-send">
            {preview.map((row) => (
              <Row key={row.id} lead={<FileTile name={row.name} />} title={row.name} meta={`To ${row.clients?.name ?? "the client"}`} status={row.skip ? <Badge plain>{row.skip}</Badge> : <Badge tone="blue">Will be emailed</Badge>} />
            ))}
          </ul>
          <form action={sendPapers} className="docs-send-foot">
            <input type="hidden" name="back" value={close} />
            {preview.map((row) => (
              <input key={row.id} type="hidden" name="pick" value={row.id} />
            ))}
            <Pending className="b b-primary" busy="Sending" disabled={mailbox?.status !== "connected" || !sending}>
              {`Send ${sending === 1 ? "1 link" : `${sending} links`}`}
            </Pending>
            <Link className="b b-secondary" href={close} scroll={false}>
              Cancel
            </Link>
          </form>
        </SidePanel>
      )}
      {params.sent && !Number.isNaN(sent) && (
        <Toast>
          {sent ? `${sent === 1 ? "1 paper" : `${sent} papers`} sent as secure links.` : "No paper was sent."}
          {skipped > 0 && ` ${skipped === 1 ? "1 was" : `${skipped} were`} skipped.`}
        </Toast>
      )}
    </div>
  );
}

// A count that arrives after the page.
async function Count({ of }: { of: Promise<number> }) {
  return <>{(await of).toLocaleString("en-IN")}</>;
}
