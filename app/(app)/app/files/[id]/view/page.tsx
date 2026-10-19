import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { periodName } from "@/src/lib/documents";
import { currentMember } from "@/src/lib/member";
import { Badge, PageHead } from "../../../ui";
import { FileViewer } from "./file-viewer";

// One filed document, shown view only to everyone in the firm who may see its client (D18).
export default async function ViewFile({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const { id } = await params;
  const { data: file } = await supabase.from("documents").select("id, client_id, name, document_type, period_key, status, clients(name)").eq("id", id).neq("status", "deleted").maybeSingle();
  if (!file) notFound();
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const viewable = ["pdf", "png", "jpg", "jpeg", "gif", "webp", "xlsx", "xls", "csv"].includes(extension);


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

      />
      {viewable ? (
        <FileViewer id={file.id} hideInactive={membership.settings.viewer_hide_inactive === true} />
      ) : (
        <p className="hint viewer-none">This kind of file cannot be shown here. Ask the owner for it.</p>
      )}
    </>
  );
}
