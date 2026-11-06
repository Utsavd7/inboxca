import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { dueLabel } from "@/src/lib/calendar";
import { Avatar, Badge, Row } from "../../ui";

export type WorkRow = { id: string; href: string; title: string; full: string; due: string; late: boolean; filed: boolean; steps: number; done: number; next: string; tag?: string; tip?: string; person?: string; unchecked: boolean };

// A client's returns on its Work tab, one row each: the due date (red only when late), the
// return and its period in short (the whole name and why it waits in its tooltip), its steps as
// dots with the next step in a few words and a quiet tag for papers still missing, and who looks
// after it. The whole row opens the return's own page. Props only.
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
            title={
              <>
                <Link className="row-link" href={row.href} title={row.full}>{row.title}</Link>
                {row.unchecked && <span className="badge plain work-tag" title="InboxCA has not yet checked this due date against the government notification.">Date not confirmed</span>}
              </>
            }
            meta={
              <span className={`stage-line${row.filed ? " is-filed" : ""}`}>
                <span className="stage-steps" role="img" aria-label={`${row.done} of ${row.steps} steps done`}>
                  {Array.from({ length: row.steps }, (_, n) => <i key={n} className={n < row.done ? "on" : undefined} />)}
                </span>
                {row.next}
                {row.tag && <span className="badge plain work-tag" title={row.tip}>{row.tag}</span>}
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

// A group of returns folded under a quiet link that opens it in place (later, filed this year).
export function WorkFold({ title, open, rows }: { title: string; open: boolean; rows: WorkRow[] }) {
  return (
    <details className="work-fold" open={open}>
      <summary>
        <span className="work-fold-show">Show</span>
        <span className="work-fold-hide">Hide</span> {title}
        <ChevronDown className="work-fold-arrow" size={15} aria-hidden />
      </summary>
      <div className="app-card">
        <WorkRows rows={rows} />
      </div>
    </details>
  );
}
