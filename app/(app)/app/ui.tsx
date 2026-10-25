import { Lock, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { PanelEscape } from "./panel-escape";
import "./side-panel.css";

// The app's small shared pieces, so every page speaks the same visual language.

export function PageHead({ title, sub, crumb, actions }: { title: React.ReactNode; sub?: React.ReactNode; crumb?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {crumb}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

// Two letters for a name or an address: "Patel Textiles" is PT, "ravi@x.in" is RA.
export const initials = (text: string) => {
  const words = text.split("@")[0].split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase();
};

// Initials on a quiet grey, never a colour: red or green would read as late or done.
export function Avatar({ name, square = false, big = false }: { name: string; square?: boolean; big?: boolean }) {
  return (
    <span className={`avatar${square ? " square" : ""}${big ? " big" : ""}`} aria-hidden>
      {initials(name)}
    </span>
  );
}

export type Tone = "blue" | "done" | "late" | "warn" | "purple" | "";
export function Badge({ tone = "", plain = false, children }: { tone?: Tone; plain?: boolean; children: React.ReactNode }) {
  return <span className={`badge ${tone}${plain ? " plain" : ""}`}>{children}</span>;
}

export function Empty({ Icon, title, children }: { Icon: LucideIcon; title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <Icon size={22} aria-hidden />
      <strong>{title}</strong>
      {children}
    </div>
  );
}

// A short note at the bottom after an action, for a page that read ?saved= or similar from
// its address. It slides up, then hides itself after five seconds (CSS only). undo is a small
// form or button that reverses the action, when one exists.
export function Toast({ children, undo }: { children: React.ReactNode; undo?: React.ReactNode }) {
  return (
    <div className="toast" role="status">
      <span>{children}</span>
      {undo}
    </div>
  );
}

// A form beside the page, opened by a link, so the list behind it stays in view. Close goes
// back to the page without the panel.
export function SidePanel({ id, title, close, children }: { id: string; title: React.ReactNode; close: string; children: React.ReactNode }) {
  return (
    <section className="side-panel panel-in" role="dialog" aria-labelledby={id}>
      <header className="side-panel-head">
        <h2 id={id}>{title}</h2>
        <Link className="b b-ghost" href={close} scroll={false} title="Close (Esc)">
          Close
        </Link>
        <PanelEscape />
      </header>
      <div className="side-panel-body">{children}</div>
    </section>
  );
}

// InboxCA storage in KB, MB or GB, for the owner's meters.
export const storage = (bytes: number) =>
  bytes < 1024 ** 2 ? `${Math.ceil(bytes / 1024)} KB` : bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(1)} GB`;

// What a page says to someone whose role does not use it, in place of sending them away.
export function NotForYou({ title, who }: { title: string; who: string }) {
  return (
    <>
      <PageHead title={title} />
      <div className="panel">
        <Empty Icon={Lock} title={`This page is for ${who}`}>
          <span>Ask the owner if something here needs changing.</span>
          <Link className="b b-primary" href="/app">
            Go to Today
          </Link>
        </Empty>
      </div>
    </>
  );
}
