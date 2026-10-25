import { Lock, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { ViewTransition, type CSSProperties } from "react";
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

// One of eight avatar hues for a name, the same every time (never the late red or done green).
export const hueOf = (name: string) => [...name.trim().toLowerCase()].reduce((hash, char) => (hash * 31 + char.codePointAt(0)!) >>> 0, 7) % 8;

// Initials on the name's own hue, so a person or client is known at a glance.
export function Avatar({ name, square = false, big = false }: { name: string; square?: boolean; big?: boolean }) {
  return (
    <span className={`avatar a${hueOf(name)}${square ? " square" : ""}${big ? " big" : ""}`} aria-hidden>
      {initials(name)}
    </span>
  );
}

// What a card or an empty state is about, as a tinted square with its icon (app.css .icon-tile).
export type Kind = "reply" | "approve" | "papers" | "late" | "notice" | "week" | "docs" | "done" | "";
export function IconTile({ Icon, kind = "" }: { Icon: LucideIcon; kind?: Kind }) {
  return (
    <span className={`icon-tile k-${kind}`} aria-hidden>
      <Icon size={16} strokeWidth={2.2} />
    </span>
  );
}

// A small number beside a card's title.
export function CountPill({ tone = "", label, children }: { tone?: "late" | "warn" | "blue" | ""; label?: string; children: React.ReactNode }) {
  return (
    <span className={`count-pill ${tone}`} aria-label={label}>
      {children}
    </span>
  );
}

// A white card: icon tile, title, count pill and anything for the right of its head (one
// action), then its rows. The section is named by its title for screen readers and tests.
export function Card({ id, title, Icon, kind, count, countTone, countLabel, end, children }: { id: string; title: React.ReactNode; Icon?: LucideIcon; kind?: Kind; count?: React.ReactNode; countTone?: "late" | "warn" | "blue" | ""; countLabel?: string; end?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="app-card" aria-labelledby={id}>
      <header className="app-card-head">
        {Icon && <IconTile Icon={Icon} kind={kind} />}
        <h2 id={id}>{title}</h2>
        {!!count && <CountPill tone={countTone} label={countLabel}>{count}</CountPill>}
        {end && <div className="head-end">{end}</div>}
      </header>
      {children}
    </section>
  );
}

// A row in a card: avatar or icon, a title over its meta, then a status pill, the actions
// that show on hover, and the one action. Rows go in <ul className="app-rows">.
export function Row({ lead, title, meta, status, more, action }: { lead?: React.ReactNode; title: React.ReactNode; meta?: React.ReactNode; status?: React.ReactNode; more?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <li className="app-row">
      {lead}
      <span className="grow">
        <strong>{title}</strong>
        {meta && <span className="sub">{meta}</span>}
      </span>
      {(status || more || action) && (
        <span className="row-end">
          {(status || more) && (
            <span className="row-swap">
              {status}
              {more && <span className="row-more">{more}</span>}
            </span>
          )}
          {action}
        </span>
      )}
    </li>
  );
}

// A number that counts up from 0 once, on the page's first showing (CSS only, app.css .count-up).
// Large numbers, which a CSS counter cannot group, are shown as they are.
export function CountUp({ value }: { value: number }) {
  if (value >= 1000) return <>{value.toLocaleString("en-IN")}</>;
  return (
    <>
      <span className="count-up" style={{ "--n": value } as CSSProperties} aria-hidden />
      <span className="sr-only">{value}</span>
    </>
  );
}

// How far through something is, as a ring that draws itself once.
export function ProgressRing({ done, total, label }: { done: number; total: number; label: string }) {
  const percent = total ? Math.min(100, Math.round((done * 100) / total)) : 0;
  return (
    <div className={`progress-ring${total && done >= total ? " is-done" : ""}`} style={{ "--ring-p": percent } as CSSProperties} role="img" aria-label={`${done} of ${total} ${label}`}>
      <svg viewBox="0 0 88 88" aria-hidden>
        <circle className="ring-track" cx="44" cy="44" r="36" />
        <circle className="ring-arc" cx="44" cy="44" r="36" />
      </svg>
      <strong aria-hidden>{percent}%</strong>
    </div>
  );
}

// A shimmering outline of a page while it loads: its title, a wide block and two columns of cards.
export function Skeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      <span className="skeleton-title" />
      <span className="skel" />
      <div className="skeleton-grid">
        {Array.from({ length: 4 }, (_, card) => <span key={card} className="skeleton-card" />)}
      </div>
    </div>
  );
}

export type Tone = "blue" | "done" | "late" | "warn" | "purple" | "";
export function Badge({ tone = "", plain = false, children }: { tone?: Tone; plain?: boolean; children: React.ReactNode }) {
  return <span className={`badge ${tone}${plain ? " plain" : ""}`}>{children}</span>;
}

// Nothing here yet: a small drawing made of the place's own icon, one line, one button.
export function Empty({ Icon, title, kind = "", children }: { Icon: LucideIcon; title: string; kind?: Kind; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-art" aria-hidden>
        <svg className={`empty-bg icon-tile k-${kind}`} viewBox="0 0 88 64">
          <rect x="12" y="14" width="40" height="34" rx="8" transform="rotate(-9 32 31)" fill="currentColor" opacity="0.12" />
          <rect x="36" y="14" width="40" height="34" rx="8" transform="rotate(9 56 31)" fill="currentColor" opacity="0.2" />
          <circle cx="8" cy="12" r="3" fill="currentColor" opacity="0.3" />
          <circle cx="82" cy="52" r="2.5" fill="currentColor" opacity="0.3" />
          <circle cx="79" cy="9" r="2" fill="currentColor" opacity="0.2" />
        </svg>
        <IconTile Icon={Icon} kind={kind} />
      </span>
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

// A form beside the page, opened by a link, so the list behind it stays in view (dimmed a
// little). It springs in from the right and slides back out the same way when Close goes back
// to the page without it.
export function SidePanel({ id, title, close, children }: { id: string; title: React.ReactNode; close: string; children: React.ReactNode }) {
  return (
    <>
      <div className="side-backdrop" aria-hidden />
      <ViewTransition enter="panel-open" exit="panel-close" default="none">
        <section className="side-panel" role="dialog" aria-labelledby={id}>
          <header className="side-panel-head">
            <h2 id={id}>{title}</h2>
            <Link className="b b-ghost" href={close} scroll={false} title="Close (Esc)">
              Close
            </Link>
            <PanelEscape />
          </header>
          <div className="side-panel-body">{children}</div>
        </section>
      </ViewTransition>
    </>
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
