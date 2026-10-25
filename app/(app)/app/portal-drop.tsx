import { FileUp } from "lucide-react";
import { dropPortalFiles } from "@/app/(app)/actions";
import { Pending } from "./pending";
import { Toast } from "./ui";

// The box for files fetched from the government portals (PLAN.md 5.3.1): drop in one or
// many, for one client or many; InboxCA reads the client and month from inside each.
export function PortalDrop({ clientId, back }: { clientId?: string; back?: string }) {
  return (
    <form action={dropPortalFiles} className="drop">
      {clientId && <input type="hidden" name="client" value={clientId} />}
      {back && <input type="hidden" name="back" value={back} />}
      <FileUp size={18} aria-hidden />
      <p className="grow">
        <label htmlFor="portal-files">
          <strong>Add portal files</strong>
        </label>
        <span className="hint">GSTR-2B and GSTR-2A downloaded from the GST portal. InboxCA reads the client and month inside each file.</span>
      </p>
      <span className="drop-pick">
        <input id="portal-files" name="files" type="file" multiple required accept=".json,application/json" />
        <Pending className="b b-secondary" type="submit">
          Add
        </Pending>
      </span>
    </form>
  );
}

// What happened to the files just dropped, from the address the drop returned to.
export function DroppedNotice({ value }: { value?: string }) {
  const [filed, again, left] = (value ?? "").split("-").map(Number);
  if (!value || [filed, again, left].some(Number.isNaN)) return null;
  const parts = [
    filed && `${filed} filed in ${filed === 1 ? "its client's folder" : "their clients' folders"}`,
    again && `${again} already there`,
    left && `${left} not filed: not a known portal file, or its GSTIN is not one of your clients'`,
  ].filter(Boolean);
  const text = `${parts.join("; ") || "No files were added"}.`;
  return left ? <p className="alert" role="status">{text}</p> : <Toast>{text}</Toast>;
}
