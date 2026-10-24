"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { draftReply, sendReply, type Draft } from "./actions";

type Paper = { id: string; name: string };

// The Inbox's keys, never required: j and k move through the list, Enter opens, r goes to the
// reply, e marks the open email done, / goes to search, Esc leaves the reply.
export function InboxKeys() {
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
      };
      if (!pick[event.key]) return;
      event.preventDefault();
      pick[event.key]();
    };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, []);
  return null;
}

function Send() {
  const { pending } = useFormStatus();
  return (
    <button className="b b-primary" disabled={pending} title="Sends from the firm's mailbox">
      {pending ? "Sending reply" : "Send reply"}
    </button>
  );
}

// The reply under an open conversation: plain text, papers from the client's drive (sent as
// secure links), files from the computer, and an AI draft when AI is set up.
export function ReplyBox({ mail, papers, suggested, ai, mayAttach }: { mail: string; papers: Paper[]; suggested: string[]; ai: boolean; mayAttach: boolean }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const text = useRef<HTMLTextAreaElement>(null);
  const [draft, ask, drafting] = useActionState<Draft, FormData>(async (previous, form) => {
    const next = await draftReply(previous, form);
    if (next.text && text.current) text.current.value = next.text;
    if (next.papers?.length) setChosen((now) => [...new Set([...now, ...next.papers!])]);
    return next;
  }, {});
  const name = new Map(papers.map((paper) => [paper.id, paper.name]));
  const add = (id: string) => setChosen((now) => (now.includes(id) || !name.has(id) ? now : [...now, id]));
  const offered = [...new Set([...suggested, ...(draft.papers ?? [])])].filter((id) => name.has(id) && !chosen.includes(id));
  return (
    <form action={sendReply} className="ib-reply" aria-label="Reply">
      <input type="hidden" name="mail" value={mail} />
      <textarea id="reply-text" ref={text} name="text" rows={4} required maxLength={20_000} aria-label="Your reply" placeholder="Write your reply. Press r to come here, Esc to leave." />
      {mayAttach && (
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
          {offered.length > 0 && <span className="ib-note">Suggested:</span>}
          {offered.map((id) => (
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
          <input type="file" name="file" multiple aria-label="Attach a file from this computer" title="Attached to the reply, kept nowhere" />
        </div>
      )}
      <div className="ib-reply-foot">
        {draft.error && <span className="ib-note" role="status">{draft.error}</span>}
        <button type="submit" className="b b-secondary" formAction={ask} formNoValidate disabled={!ai || drafting} title={ai ? "A draft for you to check. AI never sends." : "Turns on when AI is set up"}>
          {drafting ? "Writing a draft" : "Write a reply with AI"}
        </button>
        <Send />
      </div>
    </form>
  );
}
