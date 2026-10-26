import Form from "next/form";
import { cookies, headers } from "next/headers";
import { todayInIndia } from "@/src/lib/calendar";
import { DEVICE_COOKIE, deviceHash } from "@/src/lib/device";
import { currentMember } from "@/src/lib/member";
import { requestLine } from "@/src/lib/office";
import { personName } from "@/src/lib/roles";

// What would keep the person out, in plain words, for each answer of access_check.
const reasons: Record<string, string> = {
  not_member: "They are no longer in your firm.",
  hours: "It is outside their office hours, or a holiday.",
  country: "This connection is not in India, and your firm allows InboxCA only from India.",
  pc_new: "This PC is not approved for your firm yet.",
  pc_refused: "Your firm refused this PC, or took its approval back.",
  pc_personal: "This laptop is approved only for another person, or the last day it was allowed has passed.",
  connection: "This is not one of your office's internet connections.",
};

// The policy tester (PLAN.md 5.17): "Can Priya use InboxCA now, from here, on this PC?",
// answered by the database with the rules it applies to every request.
export async function AccessCheck({ person }: { person?: string }) {
  const { supabase, membership } = await currentMember();
  if (!membership) return null;
  const { data: people } = await supabase.rpc("firm_people", { target_firm: membership.firmId });
  const active = (people ?? []).filter((row) => row.status === "active");
  const chosen = active.find((row) => row.user_id === person);
  let answer: string[] | null = null;
  if (chosen) {
    const request = await headers();
    const token = (await cookies()).get(DEVICE_COOKIE)?.value;
    const { data, error } = await supabase.rpc("access_check", {
      target_firm: membership.firmId, person: chosen.user_id,
      connection: requestLine(request, todayInIndia()),
      token_digest: token ? await deviceHash(token) : "",
      country: (process.env.COUNTRY_HEADER && request.get(process.env.COUNTRY_HEADER)) || "",
    });
    if (error) throw new Error(`Access check failed: ${error.code}`);
    answer = data ?? [];
  }
  const name = personName(chosen?.email);
  const refused = (answer ?? []).filter((code) => code !== "view_only");
  return (
    <>
      <Form action="/app/settings#tester" className="set-fields">
        <input type="hidden" name="group" value="access" />
        <div>
          <label htmlFor="check-person">Person</label>
          <select id="check-person" name="check" defaultValue={chosen?.user_id ?? ""} required>
            <option value="" disabled>Choose a person</option>
            {active.map((row) => <option key={row.user_id} value={row.user_id}>{row.email}</option>)}
          </select>
        </div>
        <div className="set-foot"><button className="b b-primary" type="submit">Check</button></div>
      </Form>
      {answer && (refused.length
        ? <p className="alert" role="status"><span><strong>No.</strong> {name} cannot use InboxCA now, from here, on this PC. {refused.map((code) => reasons[code]).join(" ")}</span></p>
        : <p className="notice" role="status"><span><strong>Yes.</strong> {answer.includes("view_only") ? `${name} can use InboxCA now on this laptop, to view only.` : `${name} can use InboxCA now, from here, on this PC.`}</span></p>)}
    </>
  );
}
