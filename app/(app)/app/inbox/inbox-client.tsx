"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { draftEmail, draftReply, sendEmail, sendReply, type Draft } from "./actions";

type Paper = { id: string; name: string };

// The Inbox's keys, never required: j and k move through the list, Enter opens, r goes to the
// reply, e takes the open email out of Needs reply, / goes to search, Esc leaves the reply,
// then closes the open email back to the list.
export function InboxKeys() {
  const router = useRouter();
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key === "Escape" && target.id === "reply-text") return target.blur();
      if (event.metaKey || event.ctrlKey || event.altKey || target.closest("input, textarea, select, [contenteditable]")) return;
      const rows = [...document.querySelectorAll<HTMLAnchorElement>(".ib-row > a")];
      const at = rows.indexOf(document.activeElement as HTMLAnchorElement);
      const pick: Record<string, () => void> = {
        j: () => rows[Math.min(rows.length - 1, at + 1)]?.focus(),
        k: () => rows[Math.max(0, at === -1 ? 0 : at - 1)]?.focus(),
        r: () => document.getElementById("reply-text")?.focus(),
        e: () => document.querySelector<HTMLButtonElement>("[data-key=e]")?.click(),
        "/": () => document.querySelector<HTMLInputElement>("#mail-search")?.focus(),
        Escape: () => {
          const url = new URL(location.href);
          // Never with a side panel open, nor over a reply being written.
          if (document.querySelector(".side-panel") || document.querySelector<HTMLTextAreaElement>("#reply-text")?.value || !(url.searchParams.has("mail") || url.searchParams.has("sent"))) return;
          url.searchParams.delete("mail");
          url.searchParams.delete("sent");
          router.push(`${url.pathname}${url.search}`, { scroll: false });
        },
      };
      if (!pick[event.key]) return;
      event.preventDefault();
      pick[event.key]();
    };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, [router]);
  return null;
}

// The list and the reading pane: from a click on an email until the address changes, the pane
// shows its outline (inbox.css) and the list stays as it is.
export function Reading({ children }: { children: React.ReactNode }) {
  const now = useSearchParams().toString();
  const [from, setFrom] = useState<string | null>(null);
  const [seen, setSeen] = useState(now);
  if (seen !== now) {
    setSeen(now);
    setFrom(null);
  }
  const open = (event: React.MouseEvent) => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>(".ib-row > a");
    if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey && link.href !== location.href) setFrom(now);
  };
  return (
    <div className="split" data-opening={from === now ? "" : undefined} onClick={open}>
      {children}
    </div>
  );
}

function Send({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="b b-primary" disabled={pending} title="Sends from the firm's mailbox">
      {pending ? "Sending" : children}
    </button>
  );
}

// Papers from the client's drive (sent as secure links) and files from the computer, for a
// reply or a new email. The file input hides behind a plain button; chosen names show as tags.
function Attach({ papers, chosen, setChosen, offered = [] }: { papers: Paper[]; chosen: string[]; setChosen: React.Dispatch<React.SetStateAction<string[]>>; offered?: string[] }) {
  const [files, setFiles] = useState<string[]>([]);
  const fileId = useId();
  const name = new Map(papers.map((paper) => [paper.id, paper.name]));
  const add = (id: string) => setChosen((now) => (now.includes(id) || !name.has(id) ? now : [...now, id]));
  const offer = [...new Set(offered)].filter((id) => name.has(id) && !chosen.includes(id));
  return (
    <div className="ib-attach">
      {chosen.map((id) => (
        <span key={id} className="ib-chip on">
          <input type="hidden" name="paper" value={id} />
          {name.get(id)}
          <button type="button" onClick={() => setChosen((now) => now.filter((other) => other !== id))} aria-label={`Remove ${name.get(id)}`}>
            ×
          </button>
        </span>
      ))}
      {offer.length > 0 && <span className="ib-note">Suggested:</span>}
      {offer.map((id) => (
        <button key={id} type="button" className="ib-chip" onClick={() => add(id)} title="Goes as a secure link in this conversation">
          Add {name.get(id)}
        </button>
      ))}
      {papers.length > 0 && (
        <select aria-label="Add a paper from the drive" value="" onChange={(event) => add(event.target.value)}>
          <option value="">Add a paper from the drive</option>
          {papers.map((paper) => (
            <option key={paper.id} value={paper.id}>
              {paper.name}
            </option>
          ))}
        </select>
      )}
      <input id={fileId} className="sr-only ib-file" type="file" name="file" multiple onChange={(event) => setFiles([...(event.target.files ?? [])].map((file) => file.name))} />
      <label htmlFor={fileId} className="ib-chip" title="Attached to the email, kept nowhere">
        Upload a file
      </label>
      {files.map((file, index) => (
        <span key={`${file}${index}`} className="ib-tag" title={file}>
          <span>{file}</span>
        </span>
      ))}
    </div>
  );
}

// The reply under an open conversation: plain text, papers and files, and an AI draft only
// once AI is set up.
export function ReplyBox({ mail, papers, suggested, ai, mayAttach }: { mail: string; papers: Paper[]; suggested: string[]; ai: boolean; mayAttach: boolean }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const text = useRef<HTMLTextAreaElement>(null);
  const [draft, ask, drafting] = useActionState<Draft, FormData>(async (previous, form) => {
    const next = await draftReply(previous, form);
    if (next.text && text.current) text.current.value = next.text;
    if (next.papers?.length) setChosen((now) => [...new Set([...now, ...next.papers!])]);
    return next;
  }, {});
  return (
    <form action={sendReply} className="ib-reply" aria-label="Reply">
      <input type="hidden" name="mail" value={mail} />
      <textarea id="reply-text" ref={text} name="text" rows={4} required maxLength={20_000} aria-label="Your reply" placeholder="Write your reply. Press r to come here, Esc to leave." />
      {mayAttach && <Attach papers={papers} chosen={chosen} setChosen={setChosen} offered={[...suggested, ...(draft.papers ?? [])]} />}
      <div className="ib-reply-foot">
        {draft.error && <span className="ib-note" role="status">{draft.error}</span>}
        {ai && (
          <button type="submit" className="b b-secondary" formAction={ask} formNoValidate disabled={drafting} title="A draft for you to check. AI never sends.">
            {drafting ? "Writing a draft" : "Write a reply with AI"}
          </button>
        )}
        <Send>Send reply</Send>
      </div>
    </form>
  );
}

// A new email to one client. Who gets it is picked from the client's own addresses, never
// typed, so mail only goes to addresses InboxCA knows.
export function ComposeBox({ client, recipients, papers, ai, mayAttach }: { client: string; recipients: { value: string; label: string }[]; papers: Paper[]; ai: boolean; mayAttach: boolean }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const text = useRef<HTMLTextAreaElement>(null);
  const [draft, ask, drafting] = useActionState<Draft, FormData>(async (previous, form) => {
    const next = await draftEmail(previous, form);
    if (next.text && text.current) text.current.value = next.text;
    return next;
  }, {});
  return (
    <form action={sendEmail} className="ib-compose" aria-label="New email">
      <input type="hidden" name="client" value={client} />
      <fieldset className="ib-to">
        <legend>To</legend>
        {recipients.map((recipient, index) => (
          <label key={recipient.value} className="check">
            <input type="checkbox" name="to" value={recipient.value} defaultChecked={!index} />
            {recipient.label}
          </label>
        ))}
      </fieldset>
      <label className="ib-field">
        Subject
        <input name="subject" required maxLength={300} autoComplete="off" />
      </label>
      <textarea ref={text} name="text" rows={8} required maxLength={20_000} aria-label="Your email" placeholder="Write your email." />
      {mayAttach && <Attach papers={papers} chosen={chosen} setChosen={setChosen} />}
      <div className="ib-reply-foot">
        {draft.error && <span className="ib-note" role="status">{draft.error}</span>}
        {ai && (
          <button type="submit" className="b b-secondary" formAction={ask} formNoValidate disabled={drafting} title="A draft for you to check. AI never sends.">
            {drafting ? "Writing a draft" : "Write with AI"}
          </button>
        )}
        <Send>Send email</Send>
      </div>
    </form>
  );
}
