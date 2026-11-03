import type { Json } from "@/src/db/types";
import { dueLabel } from "@/src/lib/calendar";
import { readExtension } from "@/src/lib/notice-dates";
import { supabaseAdmin } from "@/src/lib/supabase";
import { sendSystemMail } from "@/src/lib/system-mail";
import { sources, type Source, type Watch } from "./forms-watch";
import type { Handler } from "./runner";

// The Sunday check of due dates (the user, 3 Nov 2026): the official notices the daily check
// found this week (platform_settings 'watch', items) are read for a due date extension by plain
// rules (src/lib/notice-dates.ts). A plain one takes effect at once for every firm through
// apply_notice_extension, marked as taken from that notice; anything less, a refused date, or
// a listing not read this week is left for a person, and Orelu's admins are told. Each item is
// handled once; a listing that could not be read is never taken as "no change".
export type Did = { id: string; source: string; title: string; link: string; date?: string; did: "extended" | "ask" | "nothing"; why: string; code?: string; period?: string; on?: string; notice?: string };
export type Dates = { checked?: string; week: Did[]; done: string[] };
type Item = { id: string; source: string; title: string; date?: string; link: string; seen: string };
type Apply = (code: string, period: string, on: string, link: string, notice: string, from?: string) => Promise<string>;

const refused: Record<string, string> = {
  unknown: "InboxCA keeps no rule for this return.",
  exists: "This period already has an extension, so a person decides whether it is extended again.",
  no_fixed_date: "This return's date follows the AGM, not a fixed day, so a person decides.",
  mismatch: "The earlier date in the notice is not the date InboxCA has for this period, so it may be about something else.",
  earlier: "The date in the notice is not later than the date firms have, so nothing was moved.",
};

// The notice as it is numbered ("99/2026-Central Tax", "Circular 7/2026"), or the listing and
// its date when the title carries no number.
export function noticeNumber(item: Item, source?: Source) {
  const numbered = /^([^:]*?\d+\/\d{4}[^:]*):/.exec(item.title)?.[1] ?? /\b((?:circular|notification|press release|order)\s*(?:no\.?\s*)?\d+\/\d{4})/i.exec(item.title)?.[1];
  return (numbered ?? `${source?.name ?? "An official listing"}, ${dueLabel(item.date ?? item.seen)}`).trim().slice(0, 80);
}

export async function weekOfNotices(watch: Pick<Watch, "sources" | "items">, previous: Partial<Dates>, now: Date, apply: Apply, list = sources) {
  const done = new Set(previous.done ?? []), week: Did[] = [], news: string[] = [];
  const day = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const since = (previous.checked ?? new Date(now.getTime() - 7 * 86_400_000).toISOString()).slice(0, 10);
  for (const item of (watch.items ?? []) as Item[]) {
    if (done.has(item.id) || item.seen < since) continue;
    done.add(item.id);
    const source = list.find((source) => source.key === item.source);
    const base = { id: item.id, source: item.source, title: item.title, link: item.link, ...(item.date ? { date: item.date } : {}) };
    const reading = readExtension(item.title);
    if (!reading) {
      week.push({ ...base, did: "nothing", why: "Not about a due date." });
      continue;
    }
    if ("unclear" in reading) {
      week.push({ ...base, did: "ask", why: `${reading.unclear}. A person decides; nothing was changed.` });
      news.push(`To decide: ${item.title} (${item.link})`);
      continue;
    }
    const notice = noticeNumber(item, source);
    for (const code of reading.codes) {
      const result = await apply(code, reading.period, reading.on, item.link, notice, reading.from).catch(() => "not_saved");
      if (result === "extended") {
        week.push({ ...base, did: "extended", why: `Moved ${code} for ${reading.period} to ${dueLabel(reading.on)} for every firm, from ${notice}.`, code, period: reading.period, on: reading.on, notice });
        news.push(`Extended: ${code} for ${reading.period} to ${dueLabel(reading.on)}, from ${notice} (${item.link}). Undo on /admin/due-dates.`);
      } else {
        week.push({ ...base, did: "ask", why: `${refused[result] ?? "InboxCA could not save it."} A person decides.`, code, period: reading.period, on: reading.on, notice });
        news.push(`To decide: ${item.title} (${item.link})`);
      }
    }
  }
  // A listing not read lately may hold a notice nobody saw: last week's dates stand, and a
  // person looks at the page.
  for (const source of list.filter((source) => source.kind === "list")) {
    const failures = watch.sources[source.key]?.failures ?? 0;
    if (!failures) continue;
    week.push({ id: `source:${source.key}:${day}`, source: source.key, title: source.name, link: source.url, did: "ask", why: `Could not be read for the last ${failures === 1 ? "day" : `${failures} days`}. Last week's dates stand; look at the page yourself.` });
    news.push(`Not read: ${source.name} (${source.url})`);
  }
  return { dates: { checked: now.toISOString(), week, done: [...done].slice(-500) } satisfies Dates, news };
}

export const dateWatch: Handler = async () => {
  const admin = supabaseAdmin();
  const [{ data: watch, error }, { data: dates, error: previousError }] = await Promise.all([
    admin.from("platform_settings").select("value").eq("key", "watch").maybeSingle(),
    admin.from("platform_settings").select("value").eq("key", "dates").maybeSingle(),
  ]);
  if (error || previousError) return { retry: "watch_not_read" };
  const apply: Apply = async (rule_code, rule_period, new_date, link, notice, earlier) => {
    const { data, error } = await admin.rpc("apply_notice_extension", { rule_code, rule_period, new_date, link, notice, ...(earlier ? { earlier } : {}) });
    if (error) throw new Error(error.code);
    return data;
  };
  const found = (watch?.value ?? {}) as Partial<Watch>;
  const { dates: next, news } = await weekOfNotices({ sources: found.sources ?? {}, items: found.items ?? [] }, (dates?.value ?? {}) as Partial<Dates>, new Date(), apply);
  const { error: saved } = await admin.from("platform_settings").upsert({ key: "dates", value: next as unknown as NonNullable<Json> });
  if (saved) return { retry: "dates_not_saved" };
  if (news.length) {
    const { data: admins } = await admin.from("orelu_admins").select("user_id");
    for (const { user_id } of admins ?? []) {
      const email = (await admin.auth.admin.getUserById(user_id)).data.user?.email;
      if (email) await sendSystemMail(email, "InboxCA: this week's due date check", [`The Sunday check read this week's official notices. ${news.length === 1 ? "One thing" : `${news.length} things`} to know:`, "", ...news, "", `See /admin/due-dates: ${process.env.APP_BASE_URL ?? ""}/admin/due-dates`].join("\n"));
    }
  }
  return { done: true };
};
