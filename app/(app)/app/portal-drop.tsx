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
        <span className="hint">GSTR-2B and GSTR-2A from the GST portal. Form 16 or Form No. 130, Form 26AS or Form No. 168, AIS, TIS and ITR-V from the income tax portal or TRACES. InboxCA finds the client and the period inside each file.</span>
      </p>
      <span className="drop-pick">
        <input id="portal-files" name="files" type="file" multiple required accept=".json,.txt,.pdf,application/json,text/plain,application/pdf" />
        <Pending className="b b-secondary" type="submit">
          Add
        </Pending>
      </span>
    </form>
  );
}

// What happened to the files just dropped, from the address the drop returned to.
export function DroppedNotice({ value }: { value?: string }) {
  const [filed, again, left, unsafe = 0, unchecked = 0] = (value ?? "").split("-").map(Number);
  if (!value || [filed, again, left, unsafe, unchecked].some(Number.isNaN)) return null;
  const parts = [
    filed && `${filed} saved in ${filed === 1 ? "its client's folder" : "their clients' folders"}`,
    again && `${again} already there`,
    left && `${left} not saved: InboxCA did not recognise the file, it has a password, or its GSTIN or PAN does not match any of your clients`,
    unsafe && `${unsafe} not saved: a virus, a program or a ZIP InboxCA could not open`,
    unchecked && `${unchecked} could not be checked for viruses just now; add ${unchecked === 1 ? "it" : "them"} again in a minute`,
  ].filter(Boolean);
  const text = `${parts.join("; ") || "No files were added"}.`;
  return left || unsafe || unchecked ? <p className="alert" role="status">{text}</p> : <Toast>{text}</Toast>;
}
