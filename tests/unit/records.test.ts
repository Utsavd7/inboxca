import { describe, expect, it } from "vitest";
import { askedPaper, isRoutine, pickPaper, paperPolicy } from "@/src/lib/records";

const papers = [
  { id: "itrv-25", document_type: "ITR-V", period_key: "2025", status: "filed" },
  { id: "itrv-26", document_type: "ITR-V", period_key: "2026", status: "filed" },
  { id: "bs-26", document_type: "Balance sheet", period_key: "2026", status: "filed" },
  { id: "3b-sep", document_type: "GSTR-3B", period_key: "2026-09", status: "filed" },
  { id: "3b-sep-2", document_type: "GSTR-3B", period_key: "2026-09", status: "to_check" },
];

describe("the records auto-reply", () => {
  it("reads the paper and the year a client asks for", () => {
    expect(askedPaper("ITR", "Please send my ITR for AY 2025-26")).toEqual({ types: ["ITR-V", "Acknowledgement"], period: "2025" });
    expect(askedPaper("Need financial statements", "for FY 2025-26 for the bank")).toEqual({ types: ["Balance sheet"], period: "2026" });
    expect(askedPaper("Hello", "Can we meet?").types).toEqual([]);
  });
  it("picks the one filed paper for that year, or the newest when no year is named", () => {
    expect(pickPaper(papers, { types: ["ITR-V", "Acknowledgement"], period: "2025" })).toEqual({ document: papers[0] });
    expect(pickPaper(papers, { types: ["ITR-V", "Acknowledgement"], period: "" })).toEqual({ document: papers[1] });
    // September 2026 is in FY 2026-27, the year ending March 2027.
    expect(pickPaper(papers, { types: ["GSTR-3B"], period: "2027" })).toEqual({ document: papers[3] });
    expect(pickPaper(papers, { types: ["Audit report"], period: "" })).toEqual({ reason: "record_not_found" });
  });
  it("knows Form No. 130 and Form No. 168 by either name, and finds either paper", () => {
    expect(askedPaper("Form No. 130", "Please send it for tax year 2026-27")).toEqual({ types: ["Form 130", "Form 16"], period: "2027" });
    expect(askedPaper("Form 16", "Please send my Form 16 for FY 2025-26")).toEqual({ types: ["Form 16", "Form 130"], period: "2026" });
    expect(askedPaper("Form 168", "Please send form no 168").types).toEqual(["Form 168", "Form 26AS"]);
    expect(askedPaper("26AS", "Can you share my 26AS?").types).toEqual(["Form 26AS", "Form 168"]);
    const forms = [
      { id: "f16-26", document_type: "Form 16", period_key: "2026", status: "filed" },
      { id: "f130-27", document_type: "Form 130", period_key: "2027", status: "filed" },
      { id: "26as-26", document_type: "Form 26AS", period_key: "2026", status: "filed" },
    ];
    expect(pickPaper(forms, askedPaper("Form 16", "Please send my Form 16 for tax year 2026-27"))).toEqual({ document: forms[1] });
    expect(pickPaper(forms, askedPaper("Form 130", "Please send Form No. 130 for AY 2026-27"))).toEqual({ document: forms[0] });
    expect(pickPaper(forms, askedPaper("Form 168", "Please send Form 168 for FY 2025-26"))).toEqual({ document: forms[2] });
    // With no year named, the newest of either name.
    expect(pickPaper(forms, askedPaper("Form 16", "Please send my Form 16"))).toEqual({ document: forms[1] });
  });
  it("reads a year paper's year written as FY, AY, A.Y., assessment year or tax year", () => {
    const year = [
      { id: "comp-26", document_type: "Computation", period_key: "2026", status: "filed" },
      { id: "bs-26", document_type: "Balance sheet", period_key: "2026", status: "filed" },
      { id: "audit-26", document_type: "Audit report", period_key: "2026", status: "filed" },
      { id: "comp-27", document_type: "Computation", period_key: "2027", status: "filed" },
    ];
    for (const words of ["computation for FY 2025-26", "computation for AY 2026-27", "computation for A.Y. 2026-27", "computation for assessment year 2026-27", "computation for FY 2025-2026"])
      expect(pickPaper(year, askedPaper("Request", words)), words).toEqual({ document: year[0] });
    expect(pickPaper(year, askedPaper("Request", "computation for tax year 2026-27"))).toEqual({ document: year[3] });
    expect(pickPaper(year, askedPaper("Balance sheet", "Please send the balance sheet for AY 2026-27"))).toEqual({ document: year[1] });
    expect(pickPaper(year, askedPaper("Audit report", "Please send the tax audit report for FY 2025-26"))).toEqual({ document: year[2] });
    expect(pickPaper(year, askedPaper("Audit report", "Please send the audit report for tax year 2026-27"))).toEqual({ reason: "record_not_found" });
  });
  it("never answers with a return InboxCA prepared, and says so when that is all there is", () => {
    const returns = [
      { id: "3b-aug", document_type: "GSTR-3B", period_key: "2026-08", status: "filed", prepared: null },
      { id: "3b-aug-work", document_type: "GSTR-3B", period_key: "2026-08", status: "filed", prepared: { form: "GSTR3B", status: "filed" } },
      { id: "3b-sep-work", document_type: "GSTR-3B", period_key: "2026-09", status: "filed", prepared: { form: "GSTR3B", status: "draft" } },
      { id: "itr-work", document_type: "ITR-1", period_key: "2026", status: "filed", prepared: { form: "ITR1", status: "draft" } },
    ];
    // The filed copy answers, never the working file beside it.
    expect(pickPaper(returns, { types: ["GSTR-3B"], period: "2026-08" })).toEqual({ document: returns[0] });
    expect(pickPaper(returns, { types: ["GSTR-3B", "GSTR-1"], period: "2026-08" })).toEqual({ document: returns[0] });
    // With only the working file for the month, the team sends the filed copy.
    expect(pickPaper(returns, { types: ["GSTR-3B"], period: "2026-09" })).toEqual({ reason: "record_prepared" });
    expect(pickPaper(returns, { types: ["GSTR-3B"], period: "2026-10" })).toEqual({ reason: "record_not_found" });
    // With no month named, the newest filed copy.
    expect(pickPaper(returns, { types: ["GSTR-3B"], period: "" })).toEqual({ document: returns[0] });
    expect(pickPaper(returns.slice(2), { types: ["GSTR-3B"], period: "" })).toEqual({ reason: "record_prepared" });
    // A prepared ITR is never an ITR-V or an acknowledgement.
    expect(pickPaper(returns, askedPaper("ITR", "Please send my ITR for FY 2025-26"))).toEqual({ reason: "record_not_found" });
  });
  it("answers a request for an ITR with the year's acknowledgement, never a GST return's for a month", () => {
    const acks = [
      { id: "itr-ack", document_type: "Acknowledgement", period_key: "2026", status: "filed" },
      { id: "gst-ack", document_type: "Acknowledgement", period_key: "2026-09", status: "filed" },
    ];
    expect(pickPaper(acks, askedPaper("ITR", "Please send my ITR"))).toEqual({ document: acks[0] });
    expect(pickPaper(acks.slice(1), askedPaper("ITR", "Please send last year's ITR"))).toEqual({ reason: "record_not_found" });
    expect(pickPaper(acks.slice(1), askedPaper("ITR", "Please send my ITR for FY 2026-27"))).toEqual({ reason: "record_not_found" });
    expect(pickPaper(acks, askedPaper("Acknowledgement", "Please send the acknowledgement for Sep 2026"))).toEqual({ document: acks[1] });
  });
  it("leaves papers that come several a period to the team", () => {
    const two = [
      { id: "f130-a", document_type: "Form 130", period_key: "2027", status: "filed" },
      { id: "f130-b", document_type: "Form 130", period_key: "2027", status: "filed" },
    ];
    expect(pickPaper(two, askedPaper("Form 130", "Please send Form No. 130 for tax year 2026-27"))).toEqual({ reason: "record_unclear" });
  });
  it("sends routine papers at once and keeps private ones for approval, as the owner sets", () => {
    expect(isRoutine("ITR-V")).toBe(true);
    expect(isRoutine("Balance sheet")).toBe(false);
    expect(isRoutine("Balance sheet", { routine: ["Balance sheet"] })).toBe(true);
    expect(isRoutine("ITR-V", { approve_all: true })).toBe(false);
    expect(isRoutine("Filing record")).toBe(false);
  });
});

it("keeps internal papers in the firm and applies individual choices with the firm's approval switch", () => {
  expect(paperPolicy({document_type:"ITR-V",share_policy:"internal"})).toBe("internal");
  expect(paperPolicy({document_type:"ITR-V",share_policy:"approval"})).toBe("approval");
  expect(paperPolicy({document_type:"Balance sheet",share_policy:"auto"})).toBe("auto");
  expect(paperPolicy({document_type:"ITR-V",share_policy:"auto"},{approve_all:true})).toBe("approval");
});
