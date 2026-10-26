"use client";
import { useSearchParams } from "next/navigation";
import { stopSend } from "@/app/(app)/actions";
import { ToastMotion } from "./motion";
import { Pending } from "./pending";

const notes: Record<string, string> = {
  reminded: "This client was already emailed today. Each client gets at most one email a day, so the next one can go tomorrow.",
  started: "The reminder had already started, so it could not be stopped.",
};

// After Send reminder now on a client's Returns tab: the toast with its Undo, which stops the
// email in the 20 seconds before it goes, or why nothing was sent. Read from the address.
export function RemindToast() {
  const params = useSearchParams();
  const [client, job, error] = ["reminding", "job", "error"].map((key) => params.get(key) ?? "");
  if (client && job)
    return (
      <ToastMotion>
        <span>The reminder goes out from your firm email in about 20 seconds. Undo stops it.</span>
        <form action={stopSend}>
          <input type="hidden" name="client" value={client} />
          <input type="hidden" name="job" value={job} />
          <input type="hidden" name="from" value="client" />
          <Pending className="b" busy="Stopping">Undo</Pending>
        </form>
      </ToastMotion>
    );
  const said = params.get("stopped") ? "Stopped. Nothing was sent." : notes[error];
  return said ? <ToastMotion><span>{said}</span></ToastMotion> : null;
}
