import { Badge, PageHead } from "@/app/(app)/app/ui";
import { addDays } from "@/src/lib/calendar";
import { endTemplate } from "../actions";
import { currentAdmin } from "../admin";
import { Submit } from "../parts";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// A version's periods as people say them: months for GST forms, assessment years for ITR.
function periods(form: string, from: string, until: string | null) {
  const itr = /^ITR/.test(form);
  const label = (day: string) => (itr ? `AY ${day.slice(0, 4)}-${String(Number(day.slice(0, 4)) + 1).slice(2)}` : `${months[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`);
  const first = label(from), last = until && label(itr ? `${Number(until.slice(0, 4)) - 1}-04-01` : addDays(until, -1));
  return !last ? `${first} onwards` : first === last ? first : `${first} to ${last}`;
}

// The template library's versions (D42): each official form version InboxCA fills and the
// periods it covers. The form is chosen from the period of the work, so an older version stays
// usable for its periods; a version gets a last period only with the official link that
// discontinues it, and the database logs who set it.
export default async function AdminForms({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { supabase } = await currentAdmin();
  const [{ data: templates, error }, { error: problem }] = await Promise.all([
    supabase.from("templates").select("form_code, version, valid_from, valid_until, status, source").order("form_code").order("valid_from"),
    searchParams,
  ]);
  if (error) throw new Error(`Admin forms failed: ${error.code}`);
  return (
    <>
      <PageHead title="Form versions" sub="Old and new versions stay usable together, each for its own periods, until the government discontinues one." />
      {problem === "end" && <p className="alert" role="alert">Give the last period (a month, or an assessment year for ITR) after the version&apos;s first, and the official https link that discontinues it.</p>}
      <section className="admin-card" aria-label="Form versions">
        {templates.map((template) => {
          const ended = (template.source as { ended_by?: string }).ended_by;
          return (
            <form action={endTemplate} className="admin-row admin-form" key={`${template.form_code}${template.version}`}>
              <input type="hidden" name="form" value={template.form_code} />
              <input type="hidden" name="version" value={template.version} />
              <div className="grow">
                <strong>{template.form_code} version {template.version}</strong> {template.status === "draft" && <Badge tone="warn">Draft</Badge>}
                <span className="sub">{template.valid_from ? `For ${periods(template.form_code, template.valid_from, template.valid_until)}.` : "Not used for any period yet."}</span>
                {ended && <a href={ended} target="_blank" rel="noreferrer">The notice that ends it</a>}
              </div>
              {template.status !== "draft" && template.valid_from && !template.valid_until && (
                <>
                  <label>Last period {/^ITR/.test(template.form_code) ? <input name="last" inputMode="numeric" pattern="20[0-9]{2}" placeholder="2026 for AY 2026-27" required /> : <input name="last" type="month" required />}</label>
                  <label>Official link that discontinues it <input name="link" type="url" pattern="https://.*" required /></label>
                  <Submit>Set last period</Submit>
                </>
              )}
            </form>
          );
        })}
      </section>
    </>
  );
}
