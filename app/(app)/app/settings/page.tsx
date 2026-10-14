import { redirect } from "next/navigation";
import { changeHoliday, saveHours } from "@/app/(app)/actions";
import { DAYS, SUGGESTED_HOURS, type Hours } from "@/src/lib/hours";
import { currentMember } from "@/src/lib/member";

// The owner's settings. For now: office hours and holidays (PLAN.md 5.17, "When").
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
  const hoursOnly = (settings.access as { hours_only?: boolean } | undefined)?.hours_only ?? false;

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

      <section className="app-card" aria-labelledby="holidays">
        <h2 id="holidays">Holidays</h2>
        <ul className="app-list">
          {holidays.map((date) => (
            <li key={date}>
              <span className="person">
                {new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
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
