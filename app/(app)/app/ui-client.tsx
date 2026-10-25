"use client";
import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import { Bell as BellIcon, Check, Copy, FilePlus2, FileUp, Mail, Plus, Scale, UserPlus, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { bellItems } from "@/app/(app)/actions";
import { Avatar } from "./ui";

// The quick things to start from anywhere: the New menu in the rail and the search palette
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

// The New button at the top of the rail.
export function NewMenu({ manage, write }: { manage: boolean; write: boolean }) {
  const actions = quickActions({ manage, write });
  if (!actions.length) return null;
  return (
    <Menu.Root>
      <Menu.Trigger className="b b-primary rail-new">
        <Plus size={16} aria-hidden />
        New
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

type Item = Awaited<ReturnType<typeof bellItems>>[number];
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// The bell at the foot of the rail: questions for this person and what others did on their
// clients, read when opened. The dot shows when something came since the last look.
export function Bell({ fresh }: { fresh: boolean }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [seen, setSeen] = useState(false);
  const [, start] = useTransition();
  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (!open) return;
        setSeen(true);
        start(async () => setItems(await bellItems()));
      }}
    >
      <Popover.Trigger className="b b-ghost b-icon rail-bell" aria-label={fresh && !seen ? "Updates, something new" : "Updates"} title="Updates" data-new={(fresh && !seen) || undefined}>
        <BellIcon size={16} aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="right" align="end" sideOffset={12} className="menu-layer">
          <Popover.Popup className="menu-pop bell-pop">
            <Popover.Title className="menu-head">Updates for you</Popover.Title>
            {!items ? (
              <div className="bell-list" aria-busy="true">
                {[0, 1, 2].map((row) => <span key={row} className="skel" />)}
              </div>
            ) : items.length ? (
              <div className="bell-list">
                {items.map((item) => (
                  <Link key={item.key} href={item.href}>
                    <Avatar name={item.who} />
                    <span className="grow">
                      <strong>{item.what}</strong>
                      <small>
                        {item.who}
                        {item.at && `, ${when(item.at)}`}
                      </small>
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="bell-none">Nothing new. Questions for you and changes to your clients show here.</p>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
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
          <div key={copied} className="toast" role="status">
            <span>{label} copied</span>
          </div>,
          document.body,
        )}
    </>
  );
}
