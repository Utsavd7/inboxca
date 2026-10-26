"use client";
import { Menu } from "@base-ui/react/menu";
import { Check, Copy, FilePlus2, FileUp, Mail, Plus, Scale, UserPlus, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ToastMotion } from "./motion";

// The quick things to start from anywhere: the New menu in the sidebar and the search palette
// both list these (each only for those whose role does it).
export type QuickAction = { key: string; label: string; href?: string; Icon: LucideIcon; kind: string };
export const quickActions = ({ manage, write }: { manage: boolean; write: boolean }): QuickAction[] => [
  ...(manage ? [{ key: "client", label: "New client", href: "/app/clients?panel=add", Icon: UserPlus, kind: "reply" }] : []),
  ...(write ? [{ key: "upload", label: "Upload papers", href: "/app/documents?upload=1", Icon: FileUp, kind: "docs" }] : []),
  ...(write ? [{ key: "write", label: "Write to a client", href: "/app/inbox?compose=1", Icon: Mail, kind: "approve" }] : []),
  ...(write ? [{ key: "ask", label: "Ask for papers", Icon: FilePlus2, kind: "papers" }] : []),
  ...(write ? [{ key: "notice", label: "Add a notice", href: "/app/notices?add=1", Icon: Scale, kind: "notice" }] : []),
];
// Ask for papers needs a client first: it opens the search palette to choose one.
export const ASK_EVENT = "inboxca:ask";
// The C key opens the New menu (shell.tsx Keys).
export const NEW_EVENT = "inboxca:new";

// The New button at the top of the sidebar.
export function NewMenu({ manage, write }: { manage: boolean; write: boolean }) {
  const actions = quickActions({ manage, write });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(NEW_EVENT, show);
    return () => window.removeEventListener(NEW_EVENT, show);
  }, []);
  if (!actions.length) return null;
  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger className="b b-primary rail-new" data-tip="New (C)">
        <Plus size={16} aria-hidden />
        <span className="side-text">New</span>
        <kbd className="side-kbd" aria-hidden>
          C
        </kbd>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={6} className="menu-layer">
          <Menu.Popup className="menu-pop">
            {actions.map(({ key, label, href, Icon, kind }) => {
              const inner = (
                <>
                  <span className={`icon-tile k-${kind}`} aria-hidden>
                    <Icon size={15} />
                  </span>
                  {label}
                </>
              );
              return href ? (
                <Menu.LinkItem key={key} className="menu-item" closeOnClick render={<Link href={href} scroll={false} />}>
                  {inner}
                </Menu.LinkItem>
              ) : (
                <Menu.Item key={key} className="menu-item" onClick={() => window.dispatchEvent(new Event(ASK_EVENT))}>
                  {inner}
                </Menu.Item>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

// One click copies a number or a path; a short note says it worked.
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(0);
  return (
    <>
      <button
        type="button"
        className={`copy${copied ? " is-done" : ""}`}
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          const at = Date.now();
          setCopied(at);
          setTimeout(() => setCopied((now) => (now === at ? 0 : now)), 2400);
        }}
      >
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      </button>
      {!!copied &&
        createPortal(
          <ToastMotion key={copied}>
            <span>{label} copied</span>
          </ToastMotion>,
          document.body,
        )}
    </>
  );
}

// A link whose page is fetched once the pointer rests on it or it takes focus, so the click
// shows it at once (the sidebar's links do the same).
export function WarmLink(props: React.ComponentProps<typeof Link>) {
  const [warm, setWarm] = useState(false);
  return <Link prefetch={warm || null} onMouseEnter={() => setWarm(true)} onFocus={() => setWarm(true)} {...props} />;
}
