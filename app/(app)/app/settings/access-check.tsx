import Form from "next/form";
import { cookies, headers } from "next/headers";
import { Check, X } from "lucide-react";
import { todayInIndia } from "@/src/lib/calendar";
import { DEVICE_COOKIE, deviceHash } from "@/src/lib/device";
import { describeHours, longDate, type Hours } from "@/src/lib/hours";
import { currentMember } from "@/src/lib/member";
import { memberHours, memberOffice, officeBound, requestLine, type Office } from "@/src/lib/office";
import { personName, roleLabel } from "@/src/lib/roles";
import { accessSetting } from "@/src/lib/session";

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

// Where and when a person may use InboxCA under the firm's rules now, by the rules the server
// applies to every request (office.ts officeDeviceAccess, session.ts accessSetting, open_to in
// the database): the owner and partners anywhere, the office bound roles as the office says.
function whereAndWhen(settings: Record<string, unknown>, role: string, access: unknown, branch: { kind: string; settings: unknown } | null, laptopUntil: string | null) {
  const office = memberOffice(settings.office as Office | undefined, branch) ?? {};
  const rule = (key: string) => accessSetting(settings, role, access, key);
  const india = role !== "owner" && !!rule("india_only") ? ", only from India" : "";
  const lines: { ok: boolean; text: string }[] = [];
  if (role === "owner") lines.push({ ok: true, text: "From anywhere, on the computers approved for the owner's own sign in" });
  else if (!office.on || !officeBound(role)) lines.push({ ok: true, text: `On any computer, from anywhere${india}` });
  else if (office.anywhere) lines.push({ ok: true, text: `From anywhere${india}, only on computers you approved` }, { ok: false, text: "Not on any other computer" });
  else {
    lines.push({ ok: true, text: "In the office, on a PC or laptop you approved, on the office internet connection" });
    lines.push(office.away === false
      ? { ok: false, text: "Not at home or anywhere else outside the office" }
      : { ok: true, text: laptopUntil ? `Away from the office, on their own laptop, to view only, until ${longDate(laptopUntil)}` : "Away from the office only on their own laptop once you approve it for some days, to view only" });
  }
  const hours = describeHours(memberHours(settings, branch).hours as Hours | undefined);
  lines.push(role !== "owner" && rule("hours_only")
    ? { ok: true, text: `Only in office hours${hours ? `: ${hours}` : ""}, and not on holidays` }
    : { ok: true, text: "At any time of day" });
  const idle = Number(rule("idle_minutes")) || 0;
  if (idle) lines.push({ ok: true, text: `Signed out after ${idle} minutes without use` });
  return lines;
}

// The policy tester (PLAN.md 5.17): where and when a person can use InboxCA, and "Can Priya
// use InboxCA now, from here, on this PC?", answered by the database with the rules it applies
// to every request.
export async function AccessCheck({ person }: { person?: string }) {
  const { supabase, membership } = await currentMember();
  if (!membership) return null;
  const { data: people } = await supabase.rpc("firm_people", { target_firm: membership.firmId });
  const active = (people ?? []).filter((row) => row.status === "active");
  const chosen = active.find((row) => row.user_id === person);
  let answer: string[] | null = null;
  let summary: ReturnType<typeof whereAndWhen> = [];
  if (chosen) {
    const request = await headers();
    const token = (await cookies()).get(DEVICE_COOKIE)?.value;
    const [{ data, error }, { data: member }, { data: branch }, { data: laptop }] = await Promise.all([
      supabase.rpc("access_check", {
        target_firm: membership.firmId, person: chosen.user_id,
        connection: requestLine(request, todayInIndia()),
        token_digest: token ? await deviceHash(token) : "",
        country: (process.env.COUNTRY_HEADER && request.get(process.env.COUNTRY_HEADER)) || "",
      }),
      supabase.from("firm_members").select("access").eq("firm_id", membership.firmId).eq("user_id", chosen.user_id).maybeSingle(),
      chosen.branch_id ? supabase.from("groups").select("kind, settings").eq("firm_id", membership.firmId).eq("id", chosen.branch_id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("devices").select("ends_on").eq("firm_id", membership.firmId).eq("person_id", chosen.user_id).eq("kind", "personal").eq("status", "approved").gte("ends_on", todayInIndia()).order("ends_on", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (error) throw new Error(`Access check failed: ${error.code}`);
    answer = data ?? [];
    summary = whereAndWhen(membership.settings, chosen.role, member?.access ?? null, branch, laptop?.ends_on ?? null);
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
      {chosen && answer && (
        <div className="set-access">
          <p><strong>{name}</strong>, {roleLabel(chosen.role).toLowerCase()}, can use InboxCA:</p>
          <ul aria-label={`Where and when ${name} can use InboxCA`}>
            {summary.map((line) => (
              <li key={line.text} className={line.ok ? undefined : "no"}>
                {line.ok ? <Check size={14} aria-hidden /> : <X size={14} aria-hidden />}
                {line.text}
              </li>
            ))}
          </ul>
          <p className="hint" role="status">
            {refused.length
              ? <>Right now, from here, on this PC: <strong>no</strong>. {refused.map((code) => reasons[code]).join(" ")}</>
              : <>Right now, from here, on this PC: <strong>yes</strong>{answer.includes("view_only") ? ", to view only." : "."}</>}
          </p>
        </div>
      )}
    </>
  );
}
