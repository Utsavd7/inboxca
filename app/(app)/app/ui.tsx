import type { LucideIcon } from "lucide-react";

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

// Each name keeps one of eight soft colours, so the same client is easy to spot anywhere.
const tones = ["blue", "green", "amber", "purple", "teal", "pink", "red", "gray"];
const toneOf = (name: string) => tones[[...name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7) % tones.length];

export function Avatar({ name, square = false, big = false }: { name: string; square?: boolean; big?: boolean }) {
  return (
    <span className={`avatar tone-${toneOf(name)}${square ? " square" : ""}${big ? " big" : ""}`} aria-hidden>
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
