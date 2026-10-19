import { ChevronLeft, Download } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { periodName } from "@/src/lib/documents";
import { currentMember } from "@/src/lib/member";
import { Badge, PageHead } from "../../../ui";
import { FileViewer } from "./file-viewer";

// One filed document, shown view only to everyone in the firm who may see its client (D18).
// The owner may also download it.
export default async function ViewFile({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const { id } = await params;
  const { data: file } = await supabase.from("documents").select("id, client_id, name, document_type, period_key, status, clients(name)").eq("id", id).neq("status", "deleted").maybeSingle();
  if (!file) notFound();
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const kind = extension === "pdf" ? "pdf" : ["png", "jpg", "jpeg", "gif", "webp"].includes(extension) ? "image" : null;
  const when = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

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
          </span>
        }
        actions={
          membership.role === "owner" && (
            <a className="b b-secondary" href={`/app/files/${file.id}`} download>
              <Download size={15} aria-hidden />
              Download
            </a>
          )
        }
      />
      {kind ? (
        <FileViewer id={file.id} kind={kind} watermark={`${membership.email}, ${membership.firmName}, ${when}`} hideInactive={membership.settings.viewer_hide_inactive === true} />
      ) : (
        <p className="hint viewer-none">This kind of file cannot be shown in the browser yet. {membership.role === "owner" ? "Download it to open it." : "Ask the owner for it."}</p>
      )}
    </>
  );
}
