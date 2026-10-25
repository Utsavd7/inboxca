"use client";
import { Dialog } from "@base-ui/react/dialog";
import { CornerDownLeft, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { findClients, findDocuments } from "@/app/(app)/actions";
import { clientKinds, type ClientKind } from "@/src/lib/clients";

type Page = { href: string; name: string };
type Hit = { href: string; name: string; note: string };

// True in the browser when a field has the keyboard, so a typed letter is not a shortcut.
export const typing = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest("input, textarea, select, [contenteditable]");
const nothing = () => () => {};

// Find a client or a page from anywhere: the search box in the rail, / or Ctrl K (⌘K on a Mac).
export function Command({ pages }: { pages: Page[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
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

  const hits: Hit[] = [
    ...pages.filter((page) => page.name.toLowerCase().includes(text.trim().toLowerCase())).map((page) => ({ ...page, note: "Page" })),
    ...(text.trim() ? clients : []),
  ];
  const go = (hit: Hit | undefined) => {
    if (!hit) return;
    setOpen(false);
    setText("");
    router.push(hit.href);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="rail-search" title={`Search (/ or ${mac ? "⌘K" : "Ctrl K"})`}>
        <Search size={15} aria-hidden />
        Search
        <kbd>{mac ? "⌘K" : "Ctrl K"}</kbd>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="cmd-backdrop" />
        <Dialog.Popup className="cmd" aria-label="Search">
          <div className="cmd-input">
            <Search size={16} aria-hidden />
            <input
              autoFocus
              placeholder="Type a client's name or a page"
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
                <span>{hit.name}</span>
                <small>{hit.note}</small>
                {index === active && <CornerDownLeft size={14} aria-hidden />}
              </li>
            ))}
            {!hits.length && <li className="cmd-none">No client or page by that name.</li>}
          </ul>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
