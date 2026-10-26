import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {askPermission} from "@/app/(app)/actions";
import {grantFor} from "@/src/lib/permission-grants";
import { periodName } from "@/src/lib/documents";
import { currentMember } from "@/src/lib/member";
import { Badge, PageHead } from "../../../ui";
import { Pending } from "../../../pending";
import {preparedSchema} from "@/src/lib/prepared";
import {templateSchema} from "@/src/lib/templates";
import { FileViewer } from "./file-viewer";
import { FillChecks } from "../../../return-work";

// One filed document, shown view only to everyone in the firm who may see its client (D18).
export default async function ViewFile({ params,searchParams }: { params: Promise<{ id: string }>; searchParams:Promise<{sheet?:string}> }) {
  const { supabase, membership, userId } = await currentMember();
  if (!membership) redirect("/app");
  const { id } = await params;
  const { data: file } = await supabase.from("documents").select("id, client_id, name, document_type, period_key, status, prepared, scanned_at, clients(name)").eq("firm_id",membership.firmId).eq("id", id).neq("status", "deleted").maybeSingle();
  if (!file) notFound();
  const meta=file.prepared ? preparedSchema.parse(file.prepared) : null;
  const {data:template}=meta ? await supabase.from("templates").select("*").eq("form_code",meta.form).eq("version",meta.template).maybeSingle() : {data:null};
  // In the official workbook's order, so B2B comes first.
  const sheets=template ? Object.entries(templateSchema.parse(template).mappings.sheets ?? {}).sort(([,a],[,b])=>a-b) : [];
  const asked=(await searchParams).sheet;
  const sheet=sheets.find(([,number])=>String(number)===asked)?.[1] ?? sheets[0]?.[1] ?? 1;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const canCopy=!membership.viewOnlyUntil && (membership.may("download",file.client_id) || !!await grantFor(membership.firmId,userId,"download",file.client_id,id));
  const viewable = ["pdf", "png", "jpg", "jpeg", "gif", "webp", "xlsx", "xls", "csv", "ods", "json", "txt", "docx", "odt"].includes(extension);


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
            <span>{[file.document_type, periodName(file.period_key)].filter(Boolean).join(", ")}</span>
            {file.status === "to_check" && <Badge tone="warn">To check</Badge>}
            <span className="hint">View only. Your email and the time are shown across every page.</span>
            {/* A file InboxCA made itself needs no virus check; any other says when it had none. */}
            {!file.scanned_at && !meta && file.document_type !== "Filing record" && <span className="hint">Not checked for viruses yet.</span>}
          </span>
        }

      />
      {membership.role!=="owner" && !membership.viewOnlyUntil && !meta && viewable && <div className="form-row">{canCopy ? <form method="post" action={`/app/files/${id}/stream${extension==="xlsx" ? `?sheet=${sheet}` : ""}`}><button className="b b-secondary b-small">Download these pages</button><p className="hint">A PDF with your name and the time on each page. Up to 30 pages, from this sheet for a spreadsheet.</p></form> : <form action={askPermission}><input type="hidden" name="client" value={file.client_id}/><input type="hidden" name="document" value={id}/><input type="hidden" name="right" value="download"/><Pending className="b b-ghost b-small">Ask to download</Pending></form>}</div>}
      {meta?.status==="draft" && <FillChecks client={file.client_id} sources={meta.sources} />}
      {!!sheets.length && <nav className="pills" aria-label="Form sheets">{sheets.map(([name,number])=><Link key={number} href={`?sheet=${number}`} aria-current={sheet===number ? "page" : undefined}>{name.toUpperCase().replaceAll("_"," ")}</Link>)}</nav>}
      {viewable && (!process.env.FILE_WORKER_URL || !process.env.FILE_WORKER_SECRET) ? <p className="hint viewer-none">Documents cannot be shown yet.</p> : viewable ? (
        <FileViewer key={`${file.id}-${sheet}`} id={file.id} sheet={sheet} hideInactive={membership.settings.viewer_hide_inactive === true} />
      ) : (
        <p className="hint viewer-none">This kind of file cannot be shown here. Ask the owner for it.</p>
      )}
    </>
  );
}
