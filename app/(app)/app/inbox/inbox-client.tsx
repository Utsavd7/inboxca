"use client";
import { ChevronDown, Reply, Sparkles } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { going } from "../nav-progress";
import { usePageParams } from "../shell";
import { draftEmail, draftReply, sendEmail, sendReply, type Draft } from "./actions";

type Paper = { id: string; name: string };

// The open email's reply box opens and takes the cursor (the r key, the toolbar's Reply).
const REPLY_EVENT = "inboxca:reply";
const openReply = () => window.dispatchEvent(new Event(REPLY_EVENT));
export function ReplyButton() {
  return (
    <button type="button" className="b b-ghost b-icon" aria-label="Reply" data-tip="Reply (r)" onClick={openReply}>
      <Reply size={16} aria-hidden />
    </button>
  );
}

// Inside a link: a small spinner from the click until the page it opens is ready.
export function LinkBusy() {
  return useLinkStatus().pending ? <span className="ib-busy" aria-hidden /> : null;
}

// The Inbox's keys, never required: j and k move through the list, Enter opens, r goes to the
// reply, e takes the open email out of Needs reply, h opens Snooze, / goes to search, Esc
// closes an open menu, leaves the reply, then closes the open email back to the list. A click
// outside an open menu closes it too.
export function InboxKeys() {
  const router = useRouter();
  useEffect(() => {
    const menus = () => [...document.querySelectorAll<HTMLDetailsElement>(".ib details.ib-menu[open]")];
    const outside = (event: MouseEvent) => menus().forEach((menu) => !menu.contains(event.target as Node) && menu.removeAttribute("open"));
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const open = menus();
      if (event.key === "Escape" && open.length && !document.querySelector(".side-panel")) {
        // Only the menu closes, not a paper open beside the Inbox too.
        event.stopPropagation();
        open.forEach((menu) => menu.removeAttribute("open"));
        return open[0].querySelector("summary")?.focus();
      }
      if (event.key === "Escape" && target.id === "reply-text") return target.blur();
      if (event.metaKey || event.ctrlKey || event.altKey || target.closest("input, textarea, select, [contenteditable]")) return;
      const rows = [...document.querySelectorAll<HTMLAnchorElement>(".ib-row > a")];
      const at = rows.indexOf(document.activeElement as HTMLAnchorElement);
      const pick: Record<string, () => void> = {
        j: () => rows[Math.min(rows.length - 1, at + 1)]?.focus(),
        k: () => rows[Math.max(0, at === -1 ? 0 : at - 1)]?.focus(),
        r: openReply,
        e: () => document.querySelector<HTMLButtonElement>("[data-key=e]")?.click(),
        h: () => document.querySelector<HTMLElement>("[data-key=h]")?.click(),
        "/": () => document.querySelector<HTMLInputElement>("#mail-search")?.focus(),
        Escape: () => {
          const url = new URL(location.href);
          // Never with a side panel or a paper open, nor over a reply being written (a suggested one unchanged is not).
          const box = document.querySelector<HTMLTextAreaElement>("#reply-text");
          if (document.querySelector(".side-panel, .doc-pane") || (box && box.value !== box.defaultValue) || !(url.searchParams.has("mail") || url.searchParams.has("sent"))) return;
          url.searchParams.delete("mail");
          url.searchParams.delete("sent");
          going(url.href);
          router.push(`${url.pathname}${url.search}`, { scroll: false });
        },
      };
      if (!pick[event.key]) return;
      event.preventDefault();
      pick[event.key]();
    };
    document.addEventListener("keydown", keys);
    document.addEventListener("click", outside);
    return () => {
      document.removeEventListener("keydown", keys);
      document.removeEventListener("click", outside);
    };
  }, [router]);
  return null;
}

// The selected tint on one row of the list (inbox.css), or on none.
const pick = (row?: Element | null) => document.querySelectorAll(".ib-row").forEach((each) => each.toggleAttribute("data-picked", each === row));

// The list and the reading pane: from a click on an email until the address changes, the
// clicked row takes the selected tint at once, the pane shows its outline (inbox.css) and the
// list stays as it is.
export function Reading({ children }: { children: React.ReactNode }) {
  const now = usePageParams().toString();
  const [from, setFrom] = useState<string | null>(null);
  const [seen, setSeen] = useState(now);
  if (seen !== now) {
    setSeen(now);
    setFrom(null);
  }
  // The tint follows the address: the list may still show its last rows while it refreshes.
  useEffect(() => {
    const at = new URLSearchParams(now);
    const open = at.get("mail") ?? at.get("sent");
    const links = [...document.querySelectorAll<HTMLAnchorElement>(".ib-row > a")];
    pick(open ? links.find((link) => { const its = new URL(link.href).searchParams; return (its.get("mail") ?? its.get("sent")) === open; })?.parentElement : null);
  }, [now]);
  const open = (event: React.MouseEvent) => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>(".ib-row > a");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || link.href === location.href) return;
    setFrom(now);
    pick(link.parentElement);
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
    <button className="b b-primary" disabled={pending} aria-busy={pending || undefined} title="Sends from the firm email. Ctrl or Cmd and Enter also send">
      {pending ? "Sending" : children}
    </button>
  );
}

// Ctrl or Cmd and Enter in the text sends, as in other mail programs.
const sendKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") event.currentTarget.form?.requestSubmit();
};

// Quick replies in the firm's voice: one click writes the email around the line, ready to
// change; with words already written, only the line goes in where the cursor is.
const templates = [
  { label: "Received, thank you", line: "Thank you, we have received your email and the papers with it. We will get back to you if we need anything more." },
  { label: "Please send the missing papers", line: "Thank you for your email. To finish your work we still need the papers below. Please send them by replying to this email.\n\n- " },
  { label: "We will call you", line: "Thank you for your email. Someone from our team will call you shortly about this." },
];
function Templates({ name, firm }: { name: string; firm: string }) {
  const whole = (line: string) => `Dear ${name},\n\n${line}\n\nRegards,\n${firm}`;
  const use = (button: HTMLButtonElement, line: string) => {
    const box = button.form?.elements.namedItem("text");
    if (!(box instanceof HTMLTextAreaElement)) return;
    if (!box.value.trim() || box.value === box.defaultValue || templates.some((template) => box.value === whole(template.line))) {
      box.value = whole(line);
      // The cursor waits where the person writes next: the first missing paper, or the end.
      const at = box.value.indexOf("\n- ");
      const end = at < 0 ? box.value.length : at + 3;
      box.setSelectionRange(end, end);
    } else box.setRangeText(line, box.selectionStart, box.selectionEnd, "end");
    // Counts as typed, so Esc never throws the words away.
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.focus();
  };
  return (
    <div className="ib-templates" role="group" aria-label="Quick replies">
      {templates.map((template) => (
        <button key={template.label} type="button" className="ib-chip" onClick={(event) => use(event.currentTarget, template.line)}>
          {template.label}
        </button>
      ))}
    </div>
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

// The reply under an open conversation: quick replies, plain text, papers and files, and an
// AI draft only once AI is set up. It waits as one Reply bar until clicked (or r), so the email
// has the room; it starts open on InboxCA's own answer when a person edits it. AI's draft
// (aiDraft) shows as a card to send as it is or edit. An email waiting for a person opens with
// a suggested reply written in (note says which), and, for a paper not in the drive, a way to
// ask the client for papers.
export function ReplyBox({ mail, papers, suggested, ai, mayAttach, name, firm, start, aiDraft, suggestion, askPapers, note }: { mail: string; papers: Paper[]; suggested: string[]; ai: boolean; mayAttach: boolean; name: string; firm: string; start?: string; aiDraft?: boolean; suggestion?: string; askPapers?: string; note?: string }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [view, setView] = useState<"bar" | "card" | "open">(aiDraft ? "card" : start ? "open" : "bar");
  const focus = useRef(false);
  const text = useRef<HTMLTextAreaElement>(null);
  const [draft, ask, drafting] = useActionState<Draft, FormData>(async (previous, form) => {
    const next = await draftReply(previous, form);
    if (next.text && text.current) text.current.value = next.text;
    if (next.papers?.length) setChosen((now) => [...new Set([...now, ...next.papers!])]);
    return next;
  }, {});
  useEffect(() => {
    const write = () => {
      focus.current = true;
      setView("open");
    };
    window.addEventListener(REPLY_EVENT, write);
    return () => window.removeEventListener(REPLY_EVENT, write);
  }, []);
  useEffect(() => {
    if (view !== "open" || !focus.current) return;
    focus.current = false;
    text.current?.focus();
  }, [view]);
  return (
    <form action={sendReply} className="ib-reply" data-view={view} aria-label="Reply">
      <input type="hidden" name="mail" value={mail} />
      {view === "bar" && (
        <button type="button" className="ib-reply-bar" onClick={openReply}>
          <Reply size={16} aria-hidden />
          <span className="grow">Reply to {name}</span>
          {suggestion && !start && <span className="ib-note">Suggested reply ready</span>}
          <kbd className="kbd" aria-hidden>r</kbd>
        </button>
      )}
      {view === "card" && (
        <div className="ib-card">
          <p className="ib-card-head">
            <Sparkles size={14} aria-hidden />
            <strong>AI draft</strong>
            <span>{note}</span>
          </p>
          <pre className="ib-draft-text">{start}</pre>
          <div className="ib-reply-foot">
            <button type="button" className="b b-secondary" onClick={openReply}>Edit</button>
            <Send>Send reply</Send>
          </div>
        </div>
      )}
      <div className="ib-write-reply" hidden={view !== "open"}>
        <Templates name={name} firm={firm} />
        {((note && !aiDraft) || (suggestion && !start)) && (
          <p className="ib-note ib-suggest">
            <span className="grow">{(!aiDraft && note) || "A suggested reply is written in. Change what you need, then send it."}</span>
            {askPapers && <Link className="ib-chip" href={askPapers}>Ask for papers</Link>}
          </p>
        )}
        <textarea id="reply-text" ref={text} name="text" rows={start ? 8 : suggestion ? 6 : 4} required maxLength={20_000} aria-label="Your reply" placeholder="Write your reply. Press r to come here, Esc to leave." defaultValue={start ?? suggestion} onKeyDown={sendKey} />
        <div className="ib-reply-foot">
          <button type="button" className="b b-ghost b-icon" onClick={() => setView("bar")} aria-label="Hide the reply" title="Hides the reply. What you wrote stays.">
            <ChevronDown size={16} aria-hidden />
          </button>
          {mayAttach && <Attach papers={papers} chosen={chosen} setChosen={setChosen} offered={[...suggested, ...(draft.papers ?? [])]} />}
          {draft.error && <span className="ib-note" role="status">{draft.error}</span>}
          {ai && (
            <button type="submit" className="b b-secondary" formAction={ask} formNoValidate disabled={drafting} aria-busy={drafting || undefined} title="A draft for you to check. AI never sends.">
              {drafting ? "Writing a draft" : "Write a reply with AI"}
            </button>
          )}
          <Send>Send reply</Send>
        </div>
      </div>
    </form>
  );
}

// A new email to one client. Who gets it is picked from the client's own addresses, never
// typed, so mail only goes to addresses InboxCA knows.
export function ComposeBox({ client, recipients, papers, ai, mayAttach, name, firm }: { client: string; recipients: { value: string; label: string }[]; papers: Paper[]; ai: boolean; mayAttach: boolean; name: string; firm: string }) {
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
      <Templates name={name} firm={firm} />
      <textarea ref={text} name="text" rows={8} required maxLength={20_000} aria-label="Your email" placeholder="Write your email." onKeyDown={sendKey} />
      {mayAttach && <Attach papers={papers} chosen={chosen} setChosen={setChosen} />}
      <div className="ib-reply-foot">
        {draft.error && <span className="ib-note" role="status">{draft.error}</span>}
        {ai && (
          <button type="submit" className="b b-secondary" formAction={ask} formNoValidate disabled={drafting} aria-busy={drafting || undefined} title="A draft for you to check. AI never sends.">
            {drafting ? "Writing a draft" : "Write with AI"}
          </button>
        )}
        <Send>Send email</Send>
      </div>
    </form>
  );
}
