import { describe, expect, it } from "vitest";
import { answerMode, answerOf, askedAbout, dueAnswer, filedAnswer, papersAnswer, receivedLines, type AnswerTask } from "@/src/lib/answers";
import { emailTemplates } from "@/src/lib/email-templates";
import { askedPaper, pickPaper } from "@/src/lib/records";
import { classify } from "@/src/lib/triage";

// Inbox, answered B, C and D: which client emails ask where things stand, and the answers
// InboxCA builds from its own records. Invented emails and records only.
const label = (text: string, subject = "Query", attachments: string[] = []) => classify({ subject, text, attachments }, "2026-10-26");

describe("status questions by rules", () => {
  it("knows a question about a filed return, papers still needed or what is due, in English, Hindi, Gujarati and Hinglish", () => {
    const asks: [string, string][] = [
      ["Is my GST return for September filed?", "ask_filed"],
      ["Has the ITR for AY 2026-27 been submitted?", "ask_filed"],
      ["Sir, GSTR-3B file ho gaya kya", "ask_filed"],
      ["क्या मेरा रिटर्न फाइल हो गया?", "ask_filed"],
      ["મારું રિટર્ન ફાઇલ થઈ ગયું?", "ask_filed"],
      ["Which documents are still needed from my side?", "ask_papers"],
      ["Is anything pending from my side?", "ask_papers"],
      ["Kaunse documents baki hai?", "ask_papers"],
      ["कौन से कागज बाकी हैं?", "ask_papers"],
      ["કયા દસ્તાવેજ બાકી છે?", "ask_papers"],
      ["What is due this month?", "ask_due"],
      ["When is the last date for GSTR-1?", "ask_due"],
      ["GST ki last date kya hai", "ask_due"],
      ["ITR कब तक भरना है?", "ask_due"],
    ];
    for (const [text, want] of asks) expect(label(text), text).toEqual({ label: want, reason: "status_question" });
  });

  it("leaves near misses, advice, fees and a notice's meaning for the team", () => {
    const team = [
      "I have filed my ITR myself this year.",
      "Please file my GST return.",
      "Should I file a revised ITR?",
      "Why is my return not filed yet?",
      "What are your fees for filing the return?",
      "When is our next meeting?",
      "What documents do I need for a home loan?",
      "Due to Diwali, when can we meet?",
      "Is there any penalty if the GST return is filed late?",
      "Are there any dues on my account?",
    ];
    for (const text of team) expect(label(text).label, text).toBe("other");
    // Two questions in one email, or a question with files, are for a person too.
    expect(label("Is my GST return filed? And what is due next month?")).toEqual({ label: "other", reason: "asks_several" });
    expect(label("Is my ITR filed?", "ITR", ["scan.pdf"]).label).toBe("other");
    // A notice stays a notice, and asking what it means waits for the team.
    expect(label("What does this notice mean? Is the reply due soon?")).toEqual({ label: "notice_received", reason: "notice_question" });
    // A request for a paper stays one.
    expect(label("Please send my ITR acknowledgement for AY 2025-26. Is it filed?").label).toBe("records_past");
  });

  it("keeps only which return and period a question names", () => {
    expect(askedAbout("GST", "Is GSTR-3B for September 2026 filed?")).toEqual({ form: "GSTR3B", period: "2026-09" });
    expect(askedAbout("", "Is my ITR for AY 2026-27 filed?")).toEqual({ form: "ITR", period: "2026" });
    expect(askedAbout("Hello", "What is due?")).toEqual({});
  });
});

const rule = (name: string, frequency = "monthly", verified = true) => ({ name, frequency, verified });
const task = (code: string, period_key: string, due_on: string, status = "upcoming", details: AnswerTask["details"] = {}, verified = true): AnswerTask =>
  ({ code, period_key, due_on, status, details, rule: rule(code.startsWith("ITR") ? "ITR (no business, no audit)" : `${code.slice(0, code.indexOf("_"))} (monthly)`, code.startsWith("ITR") ? "yearly" : "monthly", verified) });
const today = "2026-10-26";

describe("answers from InboxCA's records", () => {
  const sep = [
    task("GSTR1_M", "2026-09", "2026-10-11", "filed", { filed_on: "2026-10-10", ack: "AA2409261234567" }),
    task("GSTR3B_M", "2026-09", "2026-10-20", "filed", { filed_on: "2026-10-19" }),
    task("PMT06", "2026-09", "2026-10-25"),
    task("GSTR1_M", "2026-10", "2026-11-11"),
    task("GSTR3B_M", "2026-10", "2026-11-20"),
  ];
  it("says a return is filed only when every return of the period is marked filed", () => {
    expect(filedAnswer(sep, { form: "GST" }, today)).toEqual({ lines: [
      "- GSTR1 (monthly) for Sep 2026: filed on 10 Oct 2026, acknowledgement number AA2409261234567",
      "- GSTR3B (monthly) for Sep 2026: filed on 19 Oct 2026",
    ] });
    expect(filedAnswer(sep, { form: "GSTR3B", period: "2026-09" }, today)).toEqual({ lines: ["- GSTR3B (monthly) for Sep 2026: filed on 19 Oct 2026"] });
    // October is not filed yet; a person says so, never InboxCA.
    expect(filedAnswer(sep, { form: "GST", period: "2026-10" }, today)).toEqual({ team: "status_not_filed" });
    expect(filedAnswer([sep[0], { ...sep[1], status: "in_progress", details: {} }], {}, today)).toEqual({ team: "status_not_filed" });
    // A return not named, with GST and income tax both due: which one is for a person.
    expect(filedAnswer([...sep, task("ITR_NA", "2026-03", "2026-09-15", "filed", { filed_on: "2026-09-01" })], {}, today)).toEqual({ team: "status_unclear" });
    expect(filedAnswer([], { form: "ITR" }, today)).toEqual({ team: "status_unclear" });
  });

  it("lists what is due only from checked dates, and leaves a late return to a person", () => {
    expect(dueAnswer(sep.slice(3), {}, today)).toEqual({ lines: ["- GSTR1 (monthly) for Oct 2026: due on 11 Nov 2026", "- GSTR3B (monthly) for Oct 2026: due on 20 Nov 2026"] });
    expect(dueAnswer([...sep.slice(3), task("TDS_PAY", "2026-10", "2026-11-07", "upcoming", {}, false)], {}, today)).toEqual({ team: "due_unchecked" });
    expect(dueAnswer(sep, {}, today)).toEqual({ team: "due_late" });
    expect(dueAnswer(sep.slice(0, 2), {}, today)).toEqual({ team: "due_none" });
    expect(dueAnswer(sep, { form: "GSTR3B", period: "2026-10" }, today)).toEqual({ lines: ["- GSTR3B (monthly) for Oct 2026: due on 20 Nov 2026"] });
  });

  it("lists the papers still asked for with their upload link", () => {
    const ask = { period: "2026-10", missing: ["Purchase bills", "Bank statement"], link: "https://example.test/u/invented" };
    expect(papersAnswer([ask, { period: "2026-09", missing: [], link: "x" }], {})).toEqual({ lines: [
      "We still need these papers for Oct 2026:", "- Purchase bills", "- Bank statement", "Upload them here, no sign in needed: https://example.test/u/invented",
    ] });
    expect(papersAnswer([ask], { period: "2026-08" })).toEqual({ team: "papers_none" });
    expect(papersAnswer([], {})).toEqual({ team: "papers_none" });
  });

  it("says which papers arrived and where they were saved", () => {
    expect(receivedLines([
      { type: "Purchase bills", work: "gst", period: "2026-09", toCheck: false },
      { type: "Sales bills", work: "gst", period: "2026-09", toCheck: false },
      { type: "Bank statement", work: "other", period: "", toCheck: false },
      { type: "Document", work: "other", period: "", toCheck: true },
    ])).toEqual(["- Purchase bills, Sales bills: saved under GST, Sep 2026", "- Bank statement", "- 1 file our team will check"]);
    expect(emailTemplates.answer("notice", "Invented Client", "Invented Firm", []).text).toBe("Dear Invented Client,\n\nWe received your notice. Your CA will look at it.\n\nInvented Firm");
  });

  it("asks first unless the firm chose, and keeps the old papers receipt switch", () => {
    expect(answerMode({}, "filed")).toBe("ask");
    expect(answerMode({ answers: { filed: "auto", due: "off", papers: "toString" } }, "filed")).toBe("auto");
    expect(answerMode({ answers: { due: "off" } }, "due")).toBe("off");
    expect(answerMode({ answers: { papers: "toString" } }, "papers")).toBe("ask");
    expect(answerMode({ acknowledge: true }, "received")).toBe("auto");
    expect([answerOf("ask_due"), answerOf("data_gst"), answerOf("notice_received"), answerOf("records_current")]).toEqual(["due", "received", "notice", null]);
  });
});

describe("more papers for records requests", () => {
  it("picks out the computation, balance sheet, audit report, GST returns and challans", () => {
    const asked = (text: string) => askedPaper("Request", text).types;
    expect(asked("Please send the computation of income for AY 2026-27")).toEqual(["Computation"]);
    expect(asked("Need the profit & loss account and balance sheet")).toEqual(["Balance sheet"]);
    expect(asked("बैलेंस शीट भेज दीजिए")).toEqual(["Balance sheet"]);
    expect(label("बैलेंस शीट भेज दीजिए").label).toBe("records_current");
    expect(asked("Send the tax audit report")).toEqual(["Audit report"]);
    expect(asked("Please share the filed GSTR-1 for September")).toEqual(["GSTR-1"]);
    expect(asked("Please share the GST return for September")).toEqual(["GSTR-3B", "GSTR-1"]);
    expect(asked("ચલણ મોકલો")).toEqual(["Challan"]);
    expect(label("Please send the computation for AY 2026-27").label).toBe("records_current");
    expect(label("Please share GSTR-3B for September").label).toBe("records_current");
    // A GST return asked for without its name: the one filed for the month goes; both, the team picks.
    const papers = [{ document_type: "GSTR-3B", period_key: "2026-09", status: "filed" }, { document_type: "GSTR-1", period_key: "2026-09", status: "filed" }];
    expect(pickPaper(papers.slice(0, 1), askedPaper("", "GST return for Sep 2026"))).toEqual({ document: papers[0] });
    expect(pickPaper(papers, askedPaper("", "GST return for Sep 2026"))).toEqual({ reason: "record_unclear" });
  });
});
