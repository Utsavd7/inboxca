"use client";
import { Dialog } from "@base-ui/react/dialog";
import { CornerDownLeft, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { findClients, findDocuments } from "@/app/(app)/actions";
import { clientKinds, type ClientKind } from "@/src/lib/clients";
import { going } from "./nav-progress";
import { ASK_EVENT, quickActions, type QuickAction } from "./ui-client";

type Page = { href: string; name: string };
type Hit = { href: string; name: string; note: string; action?: QuickAction };

// True in the browser when a field has the keyboard, so a typed letter is not a shortcut.
export const typing = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest("input, textarea, select, [contenteditable]");
const nothing = () => () => {};

// Find a client or a page, or start something, from anywhere: the search box in the sidebar, / or
// Ctrl K (⌘K on a Mac). Ask for papers first asks which client, then opens its Ask panel.
export function Command({ pages, manage = false, write = false }: { pages: Page[]; manage?: boolean; write?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState("");
  const [clients, setClients] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [, startTransition] = useTransition();
  const mac = useSyncExternalStore(nothing, () => /Mac|iPhone|iPad/.test(navigator.platform), () => false);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((now) => !now);
      } else if (event.key === "/" && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.altKey && !typing(event.target)) {
        event.preventDefault();
        setOpen(true);
      }
    };
    const ask = () => {
      setAsking(true);
      setText("");
      setOpen(true);
    };
    window.addEventListener("keydown", key);
    window.addEventListener(ASK_EVENT, ask);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener(ASK_EVENT, ask);
    };
  }, []);
  useEffect(() => {
    if (!text.trim()) return;
    const timer = setTimeout(
      () =>
        startTransition(async () => {
          const [found, files] = await Promise.all([findClients(text), findDocuments(text)]);
          setClients([
            ...found.map((client) => ({ href: `/app/clients/${client.id}`, name: client.name, note: clientKinds[client.kind as ClientKind] ?? "Client" })),
            ...files.map((file) => ({ href: `/app/files/${file.id}/view`, name: file.name, note: file.clients?.name ?? "File" })),
          ]);
        }),
      120,
    );
    return () => clearTimeout(timer);
  }, [text]);

  const typed = text.trim().toLowerCase();
  const found = text.trim() ? clients : [];
  const hits: Hit[] = asking
    ? found.filter((hit) => hit.href.startsWith("/app/clients/")).map((hit) => ({ ...hit, href: `${hit.href}?tab=documents&ask=1`, note: "Ask for papers" }))
    : [
        ...quickActions({ manage, write }).filter((action) => action.label.toLowerCase().includes(typed)).map((action) => ({ href: action.href ?? `#${action.key}`, name: action.label, note: "Start", action })),
        ...pages.filter((page) => page.name.toLowerCase().includes(typed)).map((page) => ({ ...page, note: "Page" })),
        ...found,
      ];
  const go = (hit: Hit | undefined) => {
    if (!hit) return;
    if (hit.action && !hit.action.href) {
      setAsking(true);
      setText("");
      setActive(0);
      return;
    }
    setOpen(false);
    setAsking(false);
    setText("");
    going(hit.href);
    router.push(hit.href);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(now) => {
        setOpen(now);
        if (!now) setAsking(false);
      }}
    >
      <Dialog.Trigger className="rail-search" data-tip={`Search (/ or ${mac ? "⌘K" : "Ctrl K"})`}>
        <Search size={16} aria-hidden />
        <span className="side-text">Search or jump to</span>
        <kbd>{mac ? "⌘K" : "Ctrl K"}</kbd>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="cmd-backdrop" />
        <Dialog.Popup className="cmd" aria-label="Search">
          <div className="cmd-input">
            <Search size={16} aria-hidden />
            <input
              autoFocus
              placeholder={asking ? "Ask which client for papers? Type a name" : "Type a client's name, a page or what to do"}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") setActive((i) => Math.min(i + 1, hits.length - 1));
                else if (event.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
                else if (event.key === "Enter") go(hits[active]);
                else return;
                event.preventDefault();
              }}
              aria-label="Search clients or pages"
            />
          </div>
          <ul className="cmd-list" role="listbox" aria-label="Results">
            {hits.map((hit, index) => (
              <li
                key={hit.href}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  go(hit);
                }}
              >
                {hit.action && <hit.action.Icon size={15} aria-hidden />}
                <span>{hit.name}</span>
                <small>{hit.note}</small>
                {index === active && <CornerDownLeft size={14} aria-hidden />}
              </li>
            ))}
            {!hits.length && <li className="cmd-none">{asking ? (text.trim() ? "No client by that name." : "Type a client's name.") : "No client or page by that name."}</li>}
          </ul>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
