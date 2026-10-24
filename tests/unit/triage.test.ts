import { describe, expect, it } from "vitest";
import samples from "@/tests/fixtures/samples/emails.json";
import { classify, type Label } from "@/src/lib/triage";

// The synthetic sample pack: invented emails in English, Hindi, Gujarati and Hinglish, each
// with the label a CA would give it. M3's acceptance asks for at least 90% right.
describe("email triage by rules", () => {
  const results = samples.map((email) => ({ ...email, got: classify(email, "2026-10-17").label }));
  it("labels at least 90% of the sample emails right", () => {
    const wrong = results.filter((email) => email.got !== email.label).map((email) => `${email.subject}: ${email.label} → ${email.got}`);
    expect(wrong.length / results.length, wrong.join("\n")).toBeLessThanOrEqual(0.1);
  });
  it("sends an email it cannot place to the team rather than guess a request or data label", () => {
    const guessed = results.filter((email) => email.label === "other" && email.got !== "other");
    expect(guessed.map((email) => `${email.subject} → ${email.got as Label}`)).toEqual([]);
  });
  it("keeps a notice that asks something for the team as well", () => {
    const notice = (text: string) => classify({ subject: "GST notice", text, attachments: [] }, "2026-10-17");
    expect(notice("Sir, we received a notice from the GST department. What should we do? Please call.")).toEqual({ label: "notice_received", reason: "notice_question" });
    expect(notice("Notice received, please call me")).toEqual({ label: "notice_received", reason: "notice_question" });
    expect(notice("We received DRC-01 from the GST department.")).toEqual({ label: "notice_received", reason: "notice_words" });
  });
});
