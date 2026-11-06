import Link from "next/link";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { dueLabel } from "@/src/lib/calendar";
import { Avatar, Badge, CountPill, IconTile, Row, type Kind } from "../../ui";

export type WorkRow = { id: string; href: string; title: string; due: string; late: boolean; filed: boolean; steps: number; done: number; next: string; person?: string; unchecked: boolean };

// A client's returns on its Work tab, one row each: the due date (red only when late), the
// return and its period, its steps as dots with the next step in words, and who looks after it.
// The whole row opens the return's own page. Props only.
export function WorkRows({ rows }: { rows: WorkRow[] }) {
  return (
    <ul className="app-rows work-rows stagger">
      {rows.map((row) => {
        const [day, month] = dueLabel(row.due).split(" ");
        return (
          <Row
            key={row.id}
            lead={
              <span className={`today-date${row.late ? " is-late" : ""}`}>
                <span aria-hidden>{month}</span>
                <strong aria-hidden>{day}</strong>
                <span className="sr-only">Due {dueLabel(row.due)}</span>
              </span>
            }
            title={<><Link className="row-link" href={row.href}>{row.title}</Link>{row.unchecked && "*"}</>}
            meta={
              <span className={`stage-line${row.filed ? " is-filed" : ""}`}>
                <span className="stage-steps" role="img" aria-label={`${row.done} of ${row.steps} steps done`}>
                  {Array.from({ length: row.steps }, (_, n) => <i key={n} className={n < row.done ? "on" : undefined} />)}
                </span>
                {row.next}
              </span>
            }
            status={
              <>
                {row.late ? <Badge tone="late">Late</Badge> : row.filed && <Badge tone="done">Filed</Badge>}
                {row.person && (
                  <span className="work-person">
                    <Avatar name={row.person} />
                    {row.person}
                  </span>
                )}
                <ChevronRight className="work-go" size={16} aria-hidden />
              </>
            }
          />
        );
      })}
    </ul>
  );
}

// A group of returns folded under its head and count, which opens it (Later, Filed this year).
export function WorkFold({ title, Icon, kind, open, rows }: { title: string; Icon: LucideIcon; kind?: Kind; open: boolean; rows: WorkRow[] }) {
  return (
    <details className="app-card work-fold" open={open}>
      <summary className="app-card-head">
        <IconTile Icon={Icon} kind={kind} />
        <h2>{title}</h2>
        <CountPill>{rows.length}</CountPill>
        <ChevronDown className="work-fold-arrow" size={16} aria-hidden />
      </summary>
      <WorkRows rows={rows} />
    </details>
  );
}
