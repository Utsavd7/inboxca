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
  it("takes a request for Form 16, Form No. 130, 26AS or Form No. 168 as a request for papers, but not an email that sends one", () => {
    const email = (text: string, attachments: string[] = []) => classify({ subject: "Request", text, attachments }, "2026-10-17");
    for (const text of ["Please send my Form 16 for FY 2025-26", "Please send Form No. 130 for tax year 2026-27", "Can you share my 26AS?", "Please send form 168"])
      expect(email(text), text).toEqual({ label: "records_current", reason: "record_request" });
    expect(email("Form 16 attached. Please send the list of other papers.", ["form16.pdf"])).toEqual({ label: "data_income_tax", reason: "data_words_with_files" });
  });
  it("reads an assessment year, written out or as A.Y., as the year after its financial year", () => {
    const email = (text: string) => classify({ subject: "Request", text, attachments: [] }, "2026-10-17").label;
    for (const text of ["Please send my ITR acknowledgement for Assessment Year 2025-26", "Please send the ITR-V for A.Y. 2025-26"]) expect(email(text), text).toBe("records_past");
    for (const text of ["Please send my ITR acknowledgement for assessment year 2026-27", "Please send the ITR-V for A.Y. 2026-27"]) expect(email(text), text).toBe("records_current");
  });
  it("keeps a notice that asks something for the team as well", () => {
    const notice = (text: string) => classify({ subject: "GST notice", text, attachments: [] }, "2026-10-17");
    expect(notice("Sir, we received a notice from the GST department. What should we do? Please call.")).toEqual({ label: "notice_received", reason: "notice_question" });
    expect(notice("Notice received, please call me")).toEqual({ label: "notice_received", reason: "notice_question" });
    expect(notice("We received DRC-01 from the GST department.")).toEqual({ label: "notice_received", reason: "notice_words" });
  });
});
