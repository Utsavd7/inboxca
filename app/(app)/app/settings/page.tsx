import { redirect } from "next/navigation";
import { changeHoliday, changeSpecialHours, saveHours, saveLimits } from "@/app/(app)/actions";
import { DAYS, longDate, SUGGESTED_HOURS, type Hours, type SpecialHours } from "@/src/lib/hours";
import { currentMember } from "@/src/lib/member";
import { IDLE_CHOICES, SESSION_CHOICES } from "@/src/lib/session";

// The owner's settings. For now: office hours, holidays and signing in limits (PLAN.md 5.17).
export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { membership } = await currentMember();
  if (membership?.role !== "owner") redirect("/app");
  const { saved, error } = await searchParams;
  const settings = membership.settings;
  const hours = (settings.hours as Hours | undefined) ?? SUGGESTED_HOURS;
  const holidays = (settings.holidays as string[] | undefined) ?? [];
  const special = (settings.special_hours as SpecialHours[] | undefined) ?? [];
  const access = (settings.access ?? {}) as { hours_only?: boolean; idle_minutes?: number; session_hours?: number };
  const hoursOnly = access.hours_only ?? false;

  return (
    <>
      <h1>Settings</h1>
      <section className="app-card" aria-labelledby="hours">
        <h2 id="hours">Office hours</h2>
        <p className="app-note">India time. You can always sign in; these hours apply to everyone else.</p>
        <form action={saveHours}>
          <table className="hours-table">
            <tbody>
              {DAYS.map((name, day) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>
                    <label>
                      <input type="checkbox" name={`open-${day}`} defaultChecked={!!hours[day]} /> Open
                    </label>
                  </td>
                  <td>
                    <input type="time" name={`from-${day}`} defaultValue={hours[day]?.[0] ?? "09:00"} aria-label={`${name} opens`} />
                    {" to "}
                    <input type="time" name={`to-${day}`} defaultValue={hours[day]?.[1] ?? "18:00"} aria-label={`${name} closes`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <label className="app-check">
            <input type="checkbox" name="hours_only" defaultChecked={hoursOnly} />
            Everyone except you can use InboxCA only during office hours, and not on holidays
          </label>
          <button className="btn" type="submit">
            Save office hours
          </button>
          {saved === "hours" && (
            <p className="app-done" role="status">
              Office hours saved.
            </p>
          )}
          {error && DAYS.includes(error) && (
            <p className="field-error" role="alert">
              {error}: the closing time must be after the opening time.
            </p>
          )}
        </form>
      </section>

      <section className="app-card" aria-labelledby="special">
        <h2 id="special">Special hours</h2>
        <p className="app-note">A tax season or a late evening: these times replace the office hours on every day in the dates. Holidays stay closed.</p>
        <ul className="app-list">
          {special.map((range) => (
            <li key={range.from + range.to}>
              <span className="person">
                {range.from === range.to ? longDate(range.from) : `${longDate(range.from)} to ${longDate(range.to)}`}: {range.open} to {range.close}
              </span>
              <form action={changeSpecialHours}>
                <input type="hidden" name="from" value={range.from} />
                <input type="hidden" name="to" value={range.to} />
                <button className="btn btn-quiet" name="intent" value="remove">
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form action={changeSpecialHours} className="app-form-row">
          {[
            ["from", "From", "date"],
            ["to", "To", "date"],
            ["open", "Opens", "time"],
            ["close", "Closes", "time"],
          ].map(([name, label, type]) => (
            <div key={name}>
              <label htmlFor={`special-${name}`}>{label}</label>
              <input id={`special-${name}`} name={name} type={type} required />
            </div>
          ))}
          <button className="btn btn-quiet" type="submit">
            Add special hours
          </button>
        </form>
        {error === "special" && (
          <p className="field-error" role="alert">
            The dates must run forward and the closing time must be after the opening time.
          </p>
        )}
      </section>

      <section className="app-card" aria-labelledby="limits">
        <h2 id="limits">Signing in</h2>
        <p className="app-note">For everyone in the firm, you included.</p>
        <form action={saveLimits} className="app-form-row">
          <div>
            <label htmlFor="idle_minutes">Sign out after no activity for</label>
            <select id="idle_minutes" name="idle_minutes" defaultValue={access.idle_minutes ?? 0}>
              {IDLE_CHOICES.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes ? `${minutes} minutes` : "Never"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="session_hours">Ask for the 2 step code again after</label>
            <select id="session_hours" name="session_hours" defaultValue={access.session_hours ?? 0}>
              {SESSION_CHOICES.map((hours) => (
                <option key={hours} value={hours}>
                  {hours ? `${hours} hours` : "Only at sign in"}
                </option>
              ))}
            </select>
          </div>
          <button className="btn" type="submit">
            Save
          </button>
        </form>
        {saved === "limits" && (
          <p className="app-done" role="status">
            Signing in limits saved.
          </p>
        )}
      </section>

      <section className="app-card" aria-labelledby="holidays">
        <h2 id="holidays">Holidays</h2>
        <ul className="app-list">
          {holidays.map((date) => (
            <li key={date}>
              <span className="person">
                {new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long" })}, {longDate(date)}
              </span>
              <form action={changeHoliday}>
                <input type="hidden" name="date" value={date} />
                <button className="btn btn-quiet" name="intent" value="remove">
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form action={changeHoliday} className="app-form-row">
          <div>
            <label htmlFor="holiday">Add a holiday</label>
            <input id="holiday" type="date" name="date" required />
          </div>
          <button className="btn btn-quiet" type="submit">
            Add holiday
          </button>
        </form>
      </section>
    </>
  );
}
