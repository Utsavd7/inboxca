import { aiCredits } from "@/src/lib/ai";
import { downloadUse } from "@/src/lib/download-use";
import { supabaseAdmin } from "@/src/lib/supabase";
import { systemMailReady, systemMailUse } from "@/src/lib/system-mail";
import { Badge } from "../ui";
import { Pending } from "../pending";
import { allowDownloads } from "./fair-use-actions";

const figure = (used: number, most: number) => `${Math.min(used, most).toLocaleString("en-IN")} of ${most.toLocaleString("en-IN")}`;
const level = (used: number, most: number) => (used >= most ? <Badge tone="late">Used up</Badge> : used >= 0.8 * most ? <Badge tone="warn">80% used</Badge> : null);
const day = (date: string) => new Date(`${date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long" });

// The owner's fair use meters (PLAN.md D26, 5.14): downloads through InboxCA this month and
// InboxCA's own emails today, with the owner's OK for more downloads from 80%.
export async function FairUse({ firmId }: { firmId: string }) {
  const [downloads, mails] = await Promise.all([downloadUse(firmId), systemMailReady() ? systemMailUse(firmId) : null]);
  const paused = downloads.used >= downloads.most;
  return (
    <>
      <dl className="set-meters">
        {Number.isFinite(downloads.most) && (
          <div>
            <dt>Downloads this month {level(downloads.used, downloads.most)}</dt>
            <dd>{figure(downloads.used, downloads.most)}</dd>
            <dd className="set-bar"><span style={{ width: `${Math.min(100, Math.round((100 * downloads.used) / downloads.most))}%` }} /></dd>
            <dd className="set-meter-note">{paused ? `Paused until ${day(downloads.next)}, or until you allow more` : "By you, your team and your clients' links. Papers opened in your drive are not counted"}</dd>
          </div>
        )}
        {mails && (
          <div>
            <dt>Emails from InboxCA today {level(mails.used, mails.most)}</dt>
            <dd>{figure(mails.used, mails.most)}</dd>
            <dd className="set-bar"><span style={{ width: `${Math.min(100, Math.round((100 * mails.used) / mails.most))}%` }} /></dd>
            <dd className="set-meter-note">Invites and alert emails. After the last one, alerts wait in InboxCA until tomorrow</dd>
          </div>
        )}
      </dl>
      {downloads.used >= 0.8 * downloads.most && (
        <form action={allowDownloads} className="set-foot set-after">
          <Pending className="b b-primary" type="submit" busy="Allowing">Allow more downloads this month</Pending>
        </form>
      )}
    </>
  );
}

// The owner's AI meter (PLAN.md 5.18): this month's credits used of all the firm has, what is
// left of each top-up and when it ends, and whether auto top-up is on.
export async function AiUse({ firmId }: { firmId: string }) {
  const [credits, { data: sub }] = await Promise.all([aiCredits(firmId), supabaseAdmin().from("subscriptions").select("plan").eq("firm_id", firmId).maybeSingle()]);
  if (!credits) return null;
  const auto = (sub?.plan as { autoTopUp?: number } | null)?.autoTopUp ?? 0;
  const left = credits.topups.reduce((sum, topup) => sum + topup.left, 0);
  const until = (at: string) => new Date(at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" });
  return (
    <dl className="set-meters">
      <div>
        <dt>AI credits this month {level(credits.used, credits.available)}</dt>
        <dd>{figure(credits.used, credits.available)}</dd>
        <dd className="set-bar"><span style={{ width: `${Math.min(100, Math.round((100 * credits.used) / Math.max(1, credits.available)))}%` }} /></dd>
        <dd className="set-meter-note">{auto ? `Auto top-up is on, up to ${auto} a month` : "Auto top-up is off"}</dd>
      </div>
      <div>
        <dt>Top-ups left</dt>
        <dd>{left ? `${left.toLocaleString("en-IN")} credits` : "None"}</dd>
        <dd className="set-meter-note">{credits.topups.length ? credits.topups.map((topup) => `${topup.left.toLocaleString("en-IN")} until ${until(topup.until)}`).join(", ") : "A top-up lasts 12 months and is used after the month's own credits"}</dd>
      </div>
    </dl>
  );
}
