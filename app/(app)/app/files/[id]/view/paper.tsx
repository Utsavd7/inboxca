import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {askPermission} from "@/app/(app)/actions";
import {grantFor} from "@/src/lib/permission-grants";
import { periodName } from "@/src/lib/documents";
import { paperType } from "@/src/lib/paper-type";
import { currentMember } from "@/src/lib/member";
import { Badge, PageHead } from "../../../ui";
import { Pending } from "../../../pending";
import {formName,preparedSchema} from "@/src/lib/prepared";
import {templateSchema} from "@/src/lib/templates";
import { FileViewer } from "./file-viewer";
import { FillChecks } from "../../../return-work";
import { ItrDifferences } from "../../../itr-check";
import { itrChecks } from "@/src/lib/itr-check";
import { DocPane } from "../../../doc-pane";
import { firmAccounts } from "../../../shell-data";
import { decideForm } from "../../../form-actions";
import { PreparedForm } from "./prepared-form";

// One filed document, shown view only to everyone in the firm who may see its client (D18): as
// its own page (view/page.tsx), or in the pane beside the page it was opened from (pane, from
// @doc), with the same checks, stamps and log.
export async function Paper({ id, asked, show, from, pane = false }: { id: string; asked?: string; show?: string; from?: string; pane?: boolean }) {
  const { supabase, membership, userId } = await currentMember();
  if (!membership) redirect("/app");
  const { data: file } = await supabase.from("documents").select("id, client_id, name, document_type, period_key, status, prepared, scanned_at, size, clients(name)").eq("firm_id",membership.firmId).eq("id", id).neq("status", "deleted").maybeSingle();
  if (!file) return pane ? <DocPane name="Paper not found"><p className="hint">This paper is not available. It may have been removed.</p></DocPane> : notFound();
  const meta=file.prepared ? preparedSchema.parse(file.prepared) : null;
  const {data:template}=meta ? await supabase.from("templates").select("*").eq("form_code",meta.form).eq("version",meta.template).maybeSingle() : {data:null};
  // In the official workbook's order, so B2B comes first.
  const sheets=template ? Object.entries(templateSchema.parse(template).mappings.sheets ?? {}).sort(([,a],[,b])=>a-b) : [];
  const sheet=sheets.find(([,number])=>String(number)===asked)?.[1] ?? sheets[0]?.[1] ?? 1;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const canCopy=!membership.viewOnlyUntil && (membership.may("download",file.client_id) || !!await grantFor(membership.firmId,userId,"download",file.client_id,id));
  // A prepared return not yet filed, against the client's Form 26AS and Form 16.
  const differences=meta && /^ITR/.test(meta.form) && meta.status!=="filed" ? (await itrChecks(supabase,membership.firmId,[{client:file.client_id,period:file.period_key,form:meta.form,sources:meta.sources.map(source=>source.id)}]).catch(()=>[]))[0]?.differences ?? [] : [];
  const viewable = ["pdf", "png", "jpg", "jpeg", "gif", "webp", "xlsx", "xls", "csv", "ods", "json", "txt", "docx", "odt"].includes(extension);
  const kind = [paperType(file.document_type), periodName(file.period_key)].filter(Boolean).join(", ");
  const stream = `/app/files/${id}/stream${extension==="xlsx" ? `?sheet=${sheet}` : ""}`;
  // A prepared return opens as its form (Form view), with its stamped pages a click away (File view).
  const formable = !!meta && !!template && file.size > 0 && ["GSTR1", "GSTR3B", "ITR1", "ITR2", "ITR3", "ITR4"].includes(meta.form);
  const onForm = formable && show !== "file";
  // The second approval, for those who may give it, on the latest version waiting for it (as in Return files).
  const { data: versions } = onForm && meta.status === "draft" && !meta.filled ? await supabase.from("documents").select("id, prepared").eq("firm_id", membership.firmId).eq("client_id", file.client_id).eq("period_key", file.period_key).not("prepared", "is", null).neq("status", "deleted").order("received_at", { ascending: false }).limit(50) : { data: null };
  const head = versions?.find((version) => { const other = preparedSchema.parse(version.prepared); return other.form === meta?.form && other.registration === meta?.registration; })?.id === file.id;
  const decides = head && !membership.viewOnlyUntil && ["owner", "partner", "manager"].includes(membership.role);
  const copies = membership.role!=="owner" && !membership.viewOnlyUntil && !meta && viewable;
  const hints = (
    <>
      {meta && <span className="hint">Made on the official {formName(meta.form)} form, version {meta.template}.</span>}
      <span className="hint">View only. Your email and the time are shown across every page.</span>
      {/* A file InboxCA made itself needs no virus check; any other says when it had none. */}
      {!file.scanned_at && !meta && file.document_type !== "Filing record" && <span className="hint">Not checked for viruses yet.</span>}
    </>
  );
  const body = (
    <>
      {meta?.status==="draft" && <FillChecks client={file.client_id} sources={meta.sources} />}
      <ItrDifferences differences={differences} tick={decides && differences.length ? `approve-${file.id}` : undefined}/>
      {formable && <nav className="pills" aria-label="Show the return"><Link href="?show=form" aria-current={onForm ? "page" : undefined} scroll={false}>Form view</Link><Link href="?show=file" aria-current={onForm ? undefined : "page"} scroll={false}>File view</Link></nav>}
      {onForm ? <>
        <PreparedForm file={file} meta={meta} template={templateSchema.parse(template)} from={from}/>
        {decides && <div className="pf-foot">
          <form action={decideForm} id={`approve-${file.id}`}><input type="hidden" name="document" value={file.id}/><Pending className="b b-primary" name="decision" value="approved">Give second approval</Pending></form>
          <details className="rf-menu"><summary className="b b-secondary">Reject this version</summary><div className="rf-pop"><form action={decideForm} className="rf-pop-form">
            <input type="hidden" name="document" value={file.id}/>
            <div><label htmlFor={`reason-${file.id}`}>Reason</label><select id={`reason-${file.id}`} name="reason"><option value="figures">Figures need checking</option><option value="source">Source needs checking</option><option value="other">Other reason</option></select></div>
            <div><label htmlFor={`why-${file.id}`}>What needs to change</label><input id={`why-${file.id}`} name="explanation" minLength={3} maxLength={300} required/></div>
            <Pending className="b b-secondary" name="decision" value="rejected">Reject with reason</Pending>
          </form></div></details>
        </div>}
      </> : <>
      {!!sheets.length && <nav className="pills" aria-label="Form sheets">{sheets.map(([name,number])=><Link key={number} href={`?${formable ? "show=file&" : ""}sheet=${number}`} aria-current={sheet===number ? "page" : undefined}>{name.toUpperCase().replaceAll("_"," ")}</Link>)}</nav>}
      {viewable && (!process.env.FILE_WORKER_URL || !process.env.FILE_WORKER_SECRET) ? <p className="hint viewer-none">Papers cannot be shown yet.</p> : viewable ? (
        <FileViewer key={`${file.id}-${sheet}`} id={file.id} sheet={sheet} hideInactive={membership.settings.viewer_hide_inactive === true} />
      ) : (
        <p className="hint viewer-none">This kind of file cannot be shown here. Ask the owner for it.</p>
      )}
      </>}
    </>
  );

  if (pane) {
    // The same download as the page: the owner's original (with a drive to read it from), or
    // everyone else's stamped pages, or a request for them.
    const drive = membership.role==="owner" && !meta && (await firmAccounts()).some((account) => account.kind === "drive");
    return (
      <DocPane
        name={file.name}
        full={`/app/files/${id}/view`}
        chips={<>
          <Link className="badge" href={`/app/clients/${file.client_id}?tab=documents`}>{file.clients?.name}</Link>
          {kind && <span className="badge">{kind}</span>}
          {file.status === "to_check" && <Badge tone="warn">To check</Badge>}
        </>}
        actions={drive ? <a className="b b-secondary b-small" href={`/app/files/${id}`}>Download</a> : copies ? canCopy ? <form method="post" action={stream}><button className="b b-secondary b-small" title="A PDF with your email and the time on each page, up to 30 pages">Download</button></form> : <form action={askPermission}><input type="hidden" name="client" value={file.client_id}/><input type="hidden" name="document" value={id}/><input type="hidden" name="right" value="download"/><Pending className="b b-ghost b-small">Ask to download</Pending></form> : null}
      >
        <p className="head-meta">{hints}</p>
        {body}
      </DocPane>
    );
  }
  return (
    <>
      <PageHead
        crumb={
          <Link className="crumb" href={`/app/clients/${file.client_id}?tab=files`}>
            <ChevronLeft size={14} aria-hidden />
            {file.clients?.name}
          </Link>
        }
        title={file.name}
        sub={
          <span className="head-meta">
            <span>{kind}</span>
            {file.status === "to_check" && <Badge tone="warn">To check</Badge>}
            {hints}
          </span>
        }

      />
      {copies && <div className="form-row">{canCopy ? <form method="post" action={stream}><button className="b b-secondary b-small">Download these pages</button><p className="hint">You get a PDF with your email and the time on each page. It has up to 30 pages; for a spreadsheet, only this sheet.</p></form> : <form action={askPermission}><input type="hidden" name="client" value={file.client_id}/><input type="hidden" name="document" value={id}/><input type="hidden" name="right" value="download"/><Pending className="b b-ghost b-small">Ask to download</Pending></form>}</div>}
      {body}
    </>
  );
}
