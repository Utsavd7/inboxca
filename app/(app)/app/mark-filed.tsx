import "./mark-filed.css";
import { manageTasks } from "@/app/(app)/actions";
import { todayInIndia } from "@/src/lib/calendar";
import { Pending } from "./pending";

// Marking returns filed, from the Calendar or a client's Returns tab, in a side panel: the day
// they were filed and each one's acknowledgement number (ARN), both kept with the return. An
// income tax return (itr) can also send the client one email to e-verify it in time.
export function MarkFiled({ rows, state }: { rows: { id: string; name: string; sub: string; itr?: boolean }[]; state: React.ReactNode }) {
  const today = todayInIndia();
  const itr = rows.some((row) => row.itr);
  return (
    <form action={manageTasks} className="mark-filed">
      {state}
      <p className="hint">Type the acknowledgement number (ARN) from the portal if you have it. It is kept with the return.</p>
      <div>
        <label htmlFor="filed-on">Filed on</label>
        <input id="filed-on" type="date" name="filed_on" defaultValue={today} max={today} />
      </div>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <input type="hidden" name="task" value={row.id} />
            <span>
              <strong>{row.name}</strong>
              <span className="sub">{row.sub}</span>
            </span>
            <label htmlFor={`ack-${row.id}`}>
              ARN <span className="sr-only">for {row.name} </span>(optional)
            </label>
            <input id={`ack-${row.id}`} name={`ack-${row.id}`} maxLength={40} autoComplete="off" className="num" />
          </li>
        ))}
      </ul>
      {itr && (
        <label className="check check-row">
          <input type="checkbox" name="remind_verify" />
          Email the client to e-verify the return within 30 days
        </label>
      )}
      <div className="mark-filed-actions">
        <Pending className="b b-primary" name="intent" value="filed">
          Mark filed
        </Pending>
        <Pending className="b b-secondary" name="intent" value="in_progress">
          Mark in progress
        </Pending>
      </div>
    </form>
  );
}
