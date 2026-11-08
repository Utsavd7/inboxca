import { describe, expect, it } from "vitest";
import { feedWords, type FeedLine } from "@/src/lib/activity";

// The bell's lines (public.activity_feed, read by bellItems): each names the thing that changed,
// its client and what happened, and opens its own place. The words are the feature here.
const C = "00000000-0000-4000-8000-0000000000c1", T = "00000000-0000-4000-8000-0000000000a1";
const ME = "me", ANITA = "anita", RAVI = "ravi";
const ret = (status: string) => ({ id: T, kind: "compliance", code: "GSTR1_M", period: "2026-10", status, name: "GSTR-1 (monthly)", frequency: "monthly" });
const line = (action: string, details: unknown = null, task: unknown = null, actor: string | null = RAVI): FeedLine => ({ action, client_id: C, client_name: "Mehta Traders", details, actor_id: actor, task });
const words = (one: FeedLine, said = new Set<string>()) => feedWords(one, { me: ME, today: "2026-11-07", said, person: (id) => ({ anita: "Anita", ravi: "Ravi" })[id] ?? "Someone", team: (id) => (id === "t1" ? "GST team" : undefined) });
const base = `/app/clients/${C}`;

describe("bell words", () => {
  it("names the return, its client and what happened, with its step", () => {
    expect(words(line("form.filed", null, ret("filed")))).toEqual({ what: "GSTR-1 Oct for Mehta Traders marked filed", href: `${base}/returns/${T}?step=file` });
    expect(words(line("form.prepared", null, ret("in_progress")))).toEqual({ what: "GSTR-1 Oct for Mehta Traders prepared", href: `${base}/returns/${T}?step=approve` });
    expect(words(line("form.approved", null, ret("in_progress")))).toEqual({ what: "GSTR-1 Oct for Mehta Traders approved", href: `${base}/returns/${T}?step=file` });
    expect(words(line("form.rejected", null, ret("in_progress")))).toEqual({ what: "GSTR-1 Oct for Mehta Traders sent back", href: `${base}/returns/${T}?step=check` });
    // A form whose return is not found still says what happened, on the client's return files.
    expect(words(line("form.prepared"))).toEqual({ what: "Return for Mehta Traders prepared", href: `${base}?tab=outputs` });
    expect(words(line("task.changed", { changed: ["status"] }, ret("filed")))).toEqual({ what: "GSTR-1 Oct for Mehta Traders marked filed", href: `${base}/returns/${T}?step=file` });
    expect(words(line("task.changed", { changed: ["due_on"] }, ret("upcoming"))).what).toBe("GSTR-1 Oct for Mehta Traders due date changed");
    expect(words(line("task.covered", { person: ME }, ret("upcoming")))).toEqual({ what: "GSTR-1 Oct for Mehta Traders given to you for this once", href: `${base}/returns/${T}` });
    expect(words(line("task.covered", { person: ANITA }, ret("upcoming"))).what).toBe("GSTR-1 Oct for Mehta Traders given to Anita for this once");
  });

  it("says a status only on the newest line about it", () => {
    const said = new Set<string>();
    expect(words(line("task.changed", { changed: ["status"] }, ret("filed")), said).what).toBe("GSTR-1 Oct for Mehta Traders marked filed");
    expect(words(line("task.changed", { changed: ["status"] }, ret("filed")), said).what).toBe("GSTR-1 Oct for Mehta Traders updated");
  });

  it("names notices and to-dos, and opens them", () => {
    const notice = { id: T, kind: "notice", code: null, period: null, status: "replied", name: null, frequency: null };
    expect(words(line("task.changed", { changed: ["status", "details"] }, notice))).toEqual({ what: "Notice for Mehta Traders replied", href: `/app/notices?notice=${T}` });
    expect(words(line("notice.added", null, { ...notice, status: "upcoming" }))).toEqual({ what: "Notice added for Mehta Traders", href: `/app/notices?notice=${T}` });
    expect(words(line("task.changed", { changed: ["status"] }, { ...notice, kind: "todo", status: "closed" }))).toEqual({ what: "To-do for Mehta Traders done", href: `${base}#todos` });
  });

  it("names who took or was given the work", () => {
    expect(words(line("assignment.added", { person: ANITA, work: "gst" }, null, ANITA))).toEqual({ what: "Anita took GST for Mehta Traders", href: base });
    expect(words(line("assignment.added", { person: ME, work: "income_tax" })).what).toBe("You were given income tax for Mehta Traders");
    expect(words(line("assignment.added", { person: ANITA })).what).toBe("Anita was given Mehta Traders");
    expect(words(line("assignment.added", { team: "t1", work: "gst" })).what).toBe("GST team was given GST for Mehta Traders");
  });

  it("names papers and emails, on the client's own tab", () => {
    expect(words(line("document.uploaded"))).toEqual({ what: "Papers in for Mehta Traders", href: `${base}?tab=documents` });
    expect(words(line("request.created"))).toEqual({ what: "Papers asked from Mehta Traders", href: `${base}?tab=documents` });
    expect(words(line("reminder.sent", null, null, null))).toEqual({ what: "Reminder sent to Mehta Traders", href: `${base}?tab=emails` });
    expect(words(line("email.acknowledged")).what).toBe("Reply sent to Mehta Traders: papers received");
    expect(words(line("email.answered")).what).toBe("InboxCA replied to Mehta Traders");
    expect(words(line("email.replied")).what).toBe("Reply sent to Mehta Traders");
    expect(words(line("email.written")).what).toBe("Email sent to Mehta Traders");
  });
});
