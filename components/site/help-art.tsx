import type { CSSProperties, ReactNode } from "react";
import { Check, ChevronDown, FileText, Fingerprint, Folder, Paperclip } from "lucide-react";
import { plans, rupees } from "@/content/plans";

// The pieces of the small InboxCA screens on the help pages (content/help-scenes.tsx). They
// render on the server. CSS (.hs in globals.css) brings each piece in and plays its one cue: a
// press, a tick, a pick, a code typed. With reduced motion each piece shows as it ends.
const nth = (i: number) => ({ "--i": i }) as CSSProperties;
const initials = (name: string) => name.split(" ").filter((word) => /^[A-Z]/.test(word)).map((word) => word[0]).join("").slice(0, 2);

export function Chip({ children, tone, cue }: { children: ReactNode; tone?: "done" | "late"; cue?: boolean }) {
  return (
    <span className={`chip${tone ? ` chip-${tone}` : ""}${cue ? " hs-cue" : ""}`}>
      {tone === "done" && <Check size={12} strokeWidth={3} aria-hidden />}
      {children}
    </span>
  );
}

// A button on the screen, not a real one. press: it is clicked once the screen is in.
export function Btn({ children, quiet, press }: { children: ReactNode; quiet?: boolean; press?: boolean }) {
  return <span className={`hs-btn${quiet ? " is-quiet" : ""}${press ? " hs-press" : ""}`}>{children}</span>;
}

export const Line = ({ children }: { children: ReactNode }) => <div className="hs-line">{children}</div>;
export const Note = ({ children }: { children: ReactNode }) => <p className="hs-note">{children}</p>;
export const Title = ({ children }: { children: ReactNode }) => <p className="hs-title">{children}</p>;

export function File({ name }: { name: string }) {
  return (
    <span className="attachment hs-file">
      <FileText size={12} aria-hidden />
      <span className="num">{name}</span>
    </span>
  );
}

// Chips that come in one after another, after a label.
export function Chips({ label, items }: { label?: string; items: readonly (string | readonly [string, "done" | "late"])[] }) {
  return (
    <div className="hs-line">
      {label && <span className="hs-small hs-chips-label">{label}</span>}
      {items.map((item, i) => {
        const [text, tone] = typeof item === "string" ? [item] : item;
        return (
          <span key={text} className="hs-pop" style={nth(i + 2)}>
            <Chip tone={tone}>{text}</Chip>
          </span>
        );
      })}
    </div>
  );
}

// focus: the card a step points to, ringed once the screen is in.
export function Card({ title, line, focus, children }: { title: ReactNode; line?: ReactNode; focus?: boolean; children?: ReactNode }) {
  return (
    <div className={`card hs-card${focus ? " hs-focus" : ""}`}>
      <p className="card-title">{title}</p>
      {line && <p className="hs-small">{line}</p>}
      {children}
    </div>
  );
}

export function Mail({ from, line, subject, body, files = [], scan }: { from: string; line: string; subject: string; body?: string; files?: readonly string[]; scan?: boolean }) {
  return (
    <div className={`card hs-mail${scan ? " scan-wrap" : ""}`}>
      <div className="mail-from">
        <span className="avatar">{initials(from)}</span>
        <span>
          <strong>{from}</strong>
          <small>{line}</small>
        </span>
      </div>
      <p className="mail-subject">{subject}</p>
      {body && <p className="mail-body">{body}</p>}
      {!!files.length && (
        <div className="hs-line">
          {files.map((name, i) => (
            <span key={name} className="attachment hs-pop" style={nth(i)}>
              <Paperclip size={12} aria-hidden />
              <span className="num">{name}</span>
            </span>
          ))}
        </div>
      )}
      {scan && <span className="scan" aria-hidden />}
    </div>
  );
}

// title, a line under it, and what sits at its end (a chip or a button).
export function Rows({ rows }: { rows: readonly (readonly [ReactNode, ReactNode?, ReactNode?])[] }) {
  return (
    <div className="card hs-rows">
      {rows.map(([title, line, end], i) => (
        <div key={i} className="hs-row" style={nth(i)}>
          <span className="hs-row-text">
            <strong>{title}</strong>
            {line && <small>{line}</small>}
          </span>
          {end}
        </div>
      ))}
    </div>
  );
}

// A form field with its value typed in. select: a choice list.
export function Field({ label, value, mono, select }: { label: string; value: string; mono?: boolean; select?: boolean }) {
  return (
    <div className="hs-field">
      <span className="hs-label">{label}</span>
      <span className="hs-input">
        <span className={`hs-typed${mono ? " num" : ""}`}>{value}</span>
        {select && <ChevronDown size={14} aria-hidden />}
      </span>
    </div>
  );
}

export function Code({ label, digits }: { label: string; digits: string }) {
  return (
    <div className="hs-field">
      <span className="hs-label">{label}</span>
      <span className="hs-code">
        {[...digits].map((digit, i) => (
          <span key={i} className="num" style={nth(i)}>
            {digit}
          </span>
        ))}
      </span>
    </div>
  );
}

// Choices with one picked a moment after the screen is in. row: side by side.
export function Choice({ label, items, pick, row }: { label?: string; items: readonly string[]; pick: number; row?: boolean }) {
  return (
    <div className="hs-field">
      {label && <span className="hs-label">{label}</span>}
      <span className={row ? "hs-seg" : "hs-options"}>
        {items.map((item, i) => (
          <span key={item} className={i === pick ? "is-picked" : undefined}>
            {!row && <i aria-hidden />}
            {item}
          </span>
        ))}
      </span>
    </div>
  );
}

// Boxes ticked one after another.
export function Ticks({ items }: { items: readonly (readonly [string, boolean])[] }) {
  return (
    <div className="hs-ticks">
      {items.map(([label, on], i) => (
        <span key={label} className={on ? "is-on" : undefined} style={nth(i)}>
          <i className="tick-box">{on && <Check size={12} strokeWidth={3} aria-hidden />}</i>
          {label}
        </span>
      ))}
    </div>
  );
}

// A checklist: what came in is done, what is missing is bold.
export function Checks({ title, rows }: { title: ReactNode; rows: readonly (readonly [string, ReactNode, boolean])[] }) {
  return (
    <div className="card checklist hs-checks">
      <p className="card-title">{title}</p>
      {rows.map(([paper, end, done], i) => (
        <div key={paper} className={`check-row${done ? "" : " is-missing"}`} style={nth(i)}>
          <span className={`tick-box${done ? " is-done" : ""}`}>{done && <Check size={12} strokeWidth={3} aria-hidden />}</span>
          <span>{paper}</span>
          {end}
        </div>
      ))}
    </div>
  );
}

export function Tree({ path, file }: { path: readonly string[]; file?: string }) {
  return (
    <div className="card tree">
      {path.map((name, depth) => (
        <div key={name} className="tree-row hs-pop" style={{ paddingLeft: depth * 14, ...nth(depth) }}>
          <Folder size={14} aria-hidden />
          <span>{name}</span>
        </div>
      ))}
      {file && (
        <div className="tree-row tree-file hs-pop" style={{ paddingLeft: path.length * 14, ...nth(path.length) }}>
          <FileText size={14} aria-hidden />
          <span className="num">{file}</span>
        </div>
      )}
    </div>
  );
}

export function Rename({ from, to }: { from: string; to: string }) {
  return (
    <div className="card rename">
      <span className="rename-old num">{from}</span>
      <span className="rename-arrow">becomes</span>
      <span className="rename-new num hs-cue">{to}</span>
    </div>
  );
}

// A spreadsheet: row 1 holds the column names; bad marks the row with a problem.
export function Sheet({ rows, bad }: { rows: readonly (readonly string[])[]; bad?: number }) {
  return (
    <div className="hs-sheet" style={{ "--cols": rows[0].length } as CSSProperties}>
      {rows.map((cells, r) => (
        <div key={r} className={`hs-sheet-row${r ? "" : " is-head"}${r === bad ? " is-bad" : ""}`} style={nth(r)}>
          <span className="num">{r + 1}</span>
          {cells.map((cell, c) => (
            <span key={c}>{cell}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

// Stages in order, the first done ones ticked one after another.
export function Track({ items, done }: { items: readonly string[]; done: number }) {
  return (
    <div className="hs-track">
      {items.map((item, i) => (
        <span key={item} className={i < done ? "is-done" : i === done ? "is-next" : undefined} style={nth(i)}>
          <i>{i < done && <Check size={11} strokeWidth={3} aria-hidden />}</i>
          {item}
        </span>
      ))}
    </div>
  );
}

// Figures read from papers, each with the page it came from; checked: ticked one by one.
export function Figures({ rows, checked }: { rows: readonly (readonly [string, string, string])[]; checked?: boolean }) {
  return (
    <div className="card hs-rows">
      {rows.map(([label, from, figure], i) => (
        <div key={label} className="hs-row" style={nth(i)}>
          {checked && (
            <span className="tick-box is-done hs-pop" style={nth(i + 2)}>
              <Check size={12} strokeWidth={3} aria-hidden />
            </span>
          )}
          <span className="hs-row-text">
            <strong>{label}</strong>
            <small>{from}</small>
          </span>
          <b>{figure}</b>
        </div>
      ))}
    </div>
  );
}

export function Meter({ label, part, note }: { label: string; part: number; note: string }) {
  return (
    <div className="card hs-card">
      <p className="hs-meter-head">
        <strong>{label}</strong>
        <span>{Math.round(part * 100)}%</span>
      </p>
      <span className="hs-meter">
        <span style={{ transform: `scaleX(${part})` }} />
      </span>
      <p className="hs-small">{note}</p>
    </div>
  );
}

// A plan as plans.ts gives it, before GST.
export function Plan({ name, children }: { name: string; children?: ReactNode }) {
  const plan = plans.find((one) => one.name === name)!;
  return (
    <div className="card hs-plan">
      <p className="card-title">{plan.name}</p>
      <p className="hs-price">
        {rupees(plan.monthly)} <small>a month, before GST</small>
      </p>
      <ul>
        {[`${plan.returns} returns a year`, plan.people === 1 ? "Just you" : `A team of up to ${plan.people}`, `${plan.storage} storage`, `${plan.ai} AI credits a month`, "Unlimited clients"].map((line, i) => (
          <li key={line} className="hs-pop" style={nth(i)}>
            <Check size={12} strokeWidth={3} aria-hidden />
            {line}
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
}

export function Passkey() {
  return (
    <div className="card hs-passkey">
      <span className="hs-print">
        <Fingerprint size={30} aria-hidden />
      </span>
      <strong>Confirm with your passkey</strong>
      <span className="hs-small">Your laptop&apos;s fingerprint or PIN, your phone or a security key</span>
    </div>
  );
}

// Two lists side by side: what InboxCA does and what stays with your team.
export function Split({ ours, yours }: { ours: readonly string[]; yours: readonly string[] }) {
  return (
    <div className="hs-split">
      {(
        [
          ["InboxCA", ours],
          ["Your team", yours],
        ] as const
      ).map(([who, items], side) => (
        <div key={who} className="card">
          <p className="card-title">{who}</p>
          {items.map((item, i) => (
            <span key={item} className="hs-pop" style={nth(side * 2 + i)}>
              <Check size={12} strokeWidth={3} aria-hidden />
              {item}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

// A made up pattern in the shape of a QR code, so nothing can scan it.
export function Qr() {
  const size = 21;
  const finder = (x: number, y: number) => [0, size - 7].some((ox) => [0, size - 7].some((oy) => !(ox && oy) && x >= ox && x < ox + 7 && y >= oy && y < oy + 7));
  const ring = (x: number, y: number) => {
    const ox = x < 7 ? 0 : size - 7;
    const oy = y < 7 ? 0 : size - 7;
    const dx = x - ox;
    const dy = y - oy;
    return dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx > 1 && dx < 5 && dy > 1 && dy < 5);
  };
  const cells: [number, number][] = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) if (finder(x, y) ? ring(x, y) : (x * 7 + y * 13 + x * y) % 5 < 2) cells.push([x, y]);
  return (
    <svg className="hs-qr" viewBox={`-1 -1 ${size + 2} ${size + 2}`} aria-hidden>
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />
      ))}
    </svg>
  );
}
