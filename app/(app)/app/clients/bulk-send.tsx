"use client";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { sendClientPapers } from "@/app/(app)/actions";
import { paperType } from "@/src/lib/paper-type";

// The bar that rises when clients are ticked: choose a paper and a year, then a second step
// lists who gets what before anything is sent.
export function BulkSendBar({ types, years }: { types: string[]; years: [string, string][] }) {
  const [type, setType] = useState("");
  const [period, setPeriod] = useState(years[0]?.[0] ?? "");
  const [names, setNames] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);

  // The ticks sit in the table, joined to this form by its id.
  useEffect(() => {
    const read = () => {
      const ticked = [...document.querySelectorAll<HTMLInputElement>('input[form="bulk-send"][name="client"]:checked')].map((box) => box.dataset.name ?? "");
      setNames(ticked);
      if (!ticked.length) setConfirming(false);
    };
    read();
    document.addEventListener("change", read);
    return () => document.removeEventListener("change", read);
  }, []);
  const clients = `${names.length} ${names.length === 1 ? "client" : "clients"}`;
  // Clear unticks every client, and the bar goes back down.
  const clear = () => {
    for (const box of document.querySelectorAll<HTMLInputElement>('input[form="bulk-send"][name="client"]:checked')) box.checked = false;
    document.dispatchEvent(new Event("change"));
  };
  const year = years.find(([value]) => value === period)?.[1] ?? "";

  return (
    <form id="bulk-send" action={sendClientPapers} className="clients-bulk" aria-label="Send papers to the chosen clients">
      {confirming ? (
        <>
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="period" value={period} />
          <span className="bulk-ask">
            Send {paperType(type)} for {year} to {names.length > 5 ? `${names.slice(0, 5).join(", ")} and ${names.length - 5} more` : names.join(", ")}? A paper set to Ask before sending waits in the Inbox until someone approves it.
          </span>
          <Send label={`Send ${paperType(type)} to ${clients}`} />
          <button className="b b-secondary" type="button" onClick={() => setConfirming(false)}>
            Back
          </button>
        </>
      ) : (
        <>
          <span className="bulk-count">
            <strong>{names.length}</strong> chosen
          </span>
          <button className="b b-ghost" type="button" onClick={clear}>
            Clear
          </button>
          <span className="bulk-what">Send them a paper</span>
          <select id="bulk-paper" name="type" required aria-label="Paper" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">Choose a paper</option>
            {types.map((choice) => (
              <option key={choice} value={choice}>{paperType(choice)}</option>
            ))}
          </select>
          <select id="bulk-year" name="period" required aria-label="Year" value={period} onChange={(event) => setPeriod(event.target.value)}>
            {years.map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
          <button className="b b-primary" type="button" disabled={!type || !names.length} onClick={() => setConfirming(true)}>
            {type ? `Send ${paperType(type)} to ${clients}` : `Choose a paper for ${clients}`}
          </button>
        </>
      )}
    </form>
  );
}

function Send({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="b b-primary" type="submit" disabled={pending} aria-busy={pending || undefined}>
      {pending ? "Sending" : label}
    </button>
  );
}
