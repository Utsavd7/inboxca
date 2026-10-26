import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { receiveItem } from "@/src/lib/checklists";
import { describeFile } from "@/src/lib/documents";
import { readsFigures, recognisePortalFile } from "@/src/lib/portal-files";
import { firstYear, pdfLines, plain, recognisePortalPdf } from "@/src/lib/tax-papers";
import { readTaxPdf, readTaxText } from "../../worker/portal";
import { itrReview } from "../../worker/itr";
import { itrRequest } from "../fixtures/itr";
import { pdf } from "../fixtures/pdf";
import { ais, bankTan, employerPan, form130, form168, form16, form26asPdf, form26asText, itrAcknowledgement, itrVerification, pan, payrollForm16, tan, tis } from "../fixtures/tax-papers";

const official = "reference/official/income-tax";
const sources = JSON.parse(readFileSync(`${official}/sources.json`, "utf8")) as { file: string | null; sha256: string | null }[];
const words = async (file: string) => plain((await pdfLines(new Uint8Array(readFileSync(`${official}/${file}`)))).map((line) => line.text).join(" ")).toLowerCase();

describe("income tax papers", () => {
  it("knows each paper by its printed title and headings, and reads only its PAN and year", async () => {
    for (const [bytes, type, period] of [
      [form16("A"), "Form 16", "2026"], [form16("B"), "Form 16", "2026"], [form16("AB"), "Form 16", "2026"],
      [form130(), "Form 130", "2027"], [form26asPdf(), "Form 26AS", "2026"], [form168(), "Form 168", "2027"],
      [ais(), "AIS", "2026"], [tis(), "TIS", "2026"], [itrVerification(), "ITR-V", "2026"], [itrAcknowledgement(), "Acknowledgement", "2026"],
    ] as const)
      expect(await recognisePortalPdf(bytes), type).toEqual({ type, pan, period });
    expect(recognisePortalFile(form26asText())).toEqual({ type: "Form 26AS", pan, period: "2026" });
  });

  it("takes the employee's or taxpayer's PAN, never the employer's or a signatory's", async () => {
    // Form No. 130 prints the employer's PAN first and a signatory's in the declaration.
    expect((await recognisePortalPdf(form130()))?.pan).toBe(pan);
    expect((await recognisePortalPdf(itrAcknowledgement()))?.pan).toBe(pan);
    expect((await recognisePortalPdf(form16("A", pan)))?.pan).not.toBe(employerPan);
    // Two different PANs in one Form 16 leave it unclear, so it is not recognised.
    expect(await recognisePortalPdf(form16("AB", pan, "2026-27", "ZZZPZ0005Z"))).toBeNull(); // ggignore: another invented PAN.
  });

  it("puts assessment, financial and tax years on the product's period keys", async () => {
    expect([firstYear("2026-27"), firstYear("2026-2027"), firstYear("2026-28"), firstYear("2099-00"), firstYear("2026")]).toEqual([2026, 2026, null, 2099, null]);
    expect((await recognisePortalPdf(form16("A", pan, "2025-26")))?.period).toBe("2025");
    expect((await recognisePortalPdf(form130("2027-28")))?.period).toBe("2028");
    expect((await recognisePortalPdf(ais([[40, "Tax Year"], [120, "2026-27"]])))?.period).toBe("2027");
    // A financial year that does not lead to the assessment year beside it is unclear.
    expect(await recognisePortalPdf(form26asPdf("2024-25", "2026-27"))).toBeNull();
    expect(recognisePortalFile(form26asText(undefined, "2024-2025^2026-2027"))).toBeNull();
    expect(recognisePortalFile(form26asText(undefined, "2025-2026^2026-2027"))?.period).toBe("2026");
  });

  it("leaves near misses alone: payroll layouts, Form 16A, official blanks, locked files and plain text", async () => {
    expect(await recognisePortalPdf(payrollForm16())).toBeNull();
    expect(await recognisePortalPdf(pdf("FORM NO. 16A Certificate under section 203 of the Income-tax Act, 1961 for tax deducted at source"))).toBeNull();
    for (const file of ["Notification-51-2026-ITR-V.pdf", "AIS-FAQ.pdf"]) expect(await recognisePortalPdf(new Uint8Array(readFileSync(`${official}/${file}`))), file).toBeNull();
    expect(await recognisePortalPdf(itrVerification("invented-password"))).toBeNull();
    expect(await recognisePortalPdf(itrVerification("invented-password"), "invented-password")).toEqual({ type: "ITR-V", pan, period: "2026" });
    expect(await recognisePortalPdf(new TextEncoder().encode("Annual Tax Statement"))).toBeNull();
    expect(recognisePortalFile(form26asText(undefined, undefined, "NOTAPAN123"))).toBeNull();
    expect(recognisePortalFile(Buffer.from(form26asText().toString().replace("^Annual Tax Statement^", "^Statement^")))).toBeNull();
  });

  it("finds every marker it relies on in the official files, kept unchanged", async () => {
    for (const { file, sha256 } of sources) if (file?.endsWith(".pdf")) expect(createHash("sha256").update(readFileSync(`${official}/${file}`)).digest("hex")).toBe(sha256);
    const rules = JSON.parse(readFileSync(`${official}/it-rules-2026-forms-130-168.json`, "utf8")) as { pages: { form: string; text: string }[] };
    const form = (name: string) => plain(rules.pages.filter((page) => page.form === name).map((page) => page.text).join(" ")).toLowerCase();
    for (const marker of ["form no. 130", "certificate under section 395 for tax deducted at source on salary", "details of the employer/specified bank", "tax deduction and collection account number", "tax year", "details of the employee/specified senior citizen", "permanent account number", "summary of amount paid/credited and tax deducted at source thereon in respect of the employee", "part c (annexure - i) in relation to employees", "(d) total", 'income chargeable under the head "salaries"', "allowances to the exempt"])
      expect(form("Form No. 130"), marker).toContain(marker);
    for (const marker of ["form no. 168", "[ see rule 245]", "annual information statement", "tax year:", "part a: particulars of the person", "4. pan", "part b: nature of information"]) expect(form("Form No. 168"), marker).toContain(marker);
    const itr = await words("Notification-51-2026-ITR-V.pdf");
    for (const marker of ["indian income tax return verification", "indian income tax return acknowledgement", "e-filing acknowledgement", "assessment year", "verification", "current year business loss"]) expect(itr, marker).toContain(marker);
    const faq = await words("AIS-FAQ.pdf");
    for (const marker of ["annual information statement", "general information", "tds/tcs information", "sft information", "taxpayer information summary", "information category"]) expect(faq, marker).toContain(marker);
  });

  it("reads the Form 26AS text file's Part I deductors and rows by their header names", () => {
    const read = readTaxText(form26asText())!;
    expect(read).toMatchObject({ kind: "Form 26AS", version: "text", pan, period: "2026" });
    const value = (field: string) => read.lines.find((line) => line.field === field);
    expect(value("f26as.tds.0.tan")).toMatchObject({ value: tan, kind: "text", label: "Deductor 1: TAN", page: 1, path: "/line/6" });
    expect(value("f26as.tds.0.name")?.value).toBe("INVENTED SOFTWARE PRIVATE LIMITED");
    expect(value("f26as.tds.0.deducted")).toMatchObject({ value: "64480.00", kind: "number", label: `${tan}: total tax deducted` });
    expect(value("f26as.tds.0.rows.1.date")).toMatchObject({ value: "2025-12-31", kind: "date", label: `${tan}, row 2: transaction date` });
    expect(value("f26as.tds.1.rows.0.section")?.value).toBe("194A");
    expect(value("f26as.tds.1.rows.0.status")?.value).toBe("U");
    expect(value("f26as.tds.1.tan")?.value).toBe(bankTan);
    // Five figures a deductor and six a row; Part II and later parts are not read.
    expect(read.lines).toHaveLength(2 * 5 + 3 * 6);
  });

  it("keeps a reversal's minus sign, reads nothing from an empty Part I, and refuses a row it cannot place", () => {
    const [heads, deductor, entries, first] = form26asText().toString().split("\n").slice(4, 8);
    const reversal = readTaxText(form26asText([heads, deductor, entries, first, "^2^192^31-Mar-2026^F^30-Apr-2026^B^-5000.00^-1000.00^-1000.00^"]))!;
    expect(reversal.lines.find((line) => line.field === "f26as.tds.0.rows.1.deducted")?.value).toBe("-1000.00");
    const empty = form26asText([heads, "^^^*********** No Transactions Present **********^"]);
    expect(recognisePortalFile(empty)).toEqual({ type: "Form 26AS", pan, period: "2026" });
    expect(readTaxText(empty)).toBeNull();
    expect(readTaxText(form26asText([heads, deductor, entries, "^1^192^31-Feb-2026^F^-^-^1.00^0.00^0.00^"]))).toBeNull();
    expect(readTaxText(form26asText([heads, deductor, "an unknown line"]))).toBeNull();
    // Rows past the 30 pages the viewer shows beside a figure are not read.
    expect(readTaxText(form26asText([heads, deductor, entries, ...Array.from({ length: 1300 }, (_, n) => `^${n + 1}^192^30-Jun-2025^F^31-Jul-2025^-^1.00^0.00^0.00^`)]))).toBeNull();
  });

  it("reads the salary figures the return has fields for from Form 16 and Form No. 130", async () => {
    const fields = async (bytes: Uint8Array) => Object.fromEntries((await readTaxPdf(bytes))!.lines.map((line) => [line.field, line.value]));
    const salary = { "itr.salary.gross": "1200000.00", "itr.salary.income": "1125000.00" };
    expect(await fields(form16("AB"))).toEqual({ ...salary, "itr.tds.salary.0.tan": tan, "itr.tds.salary.0.income": "1125000.00", "itr.tds.salary.0.deducted": "64480.00" });
    // Part A alone gives the TDS row; Part B alone gives the salary and leaves the row to Part A.
    expect(await fields(form16("A"))).toEqual({ "itr.tds.salary.0.tan": tan, "itr.tds.salary.0.deducted": "64480.00" });
    expect(await fields(form16("B"))).toEqual(salary);
    expect((await readTaxPdf(form16("AB")))?.lines.find((line) => line.field === "itr.tds.salary.0.deducted")).toMatchObject({ label: "TDS on salary", page: 1, kind: "number" });
    expect(await fields(form130())).toEqual({ "itr.salary.gross": "1300000.00", "itr.salary.income": "1225000.00", "itr.tds.salary.0.tan": tan, "itr.tds.salary.0.income": "1225000.00", "itr.tds.salary.0.deducted": "65000.00" });
    for (const bytes of [payrollForm16(), form26asPdf(), itrVerification()]) expect(await readTaxPdf(bytes)).toBeNull();
  });

  it("leaves a paper's own rows out of the return while it fills from the return's fields", () => {
    const request = itrRequest("ITR1");
    const rows = readTaxText(form26asText())!.lines.map((line): [string, { label: string; value: string; kind: typeof line.kind }] => [line.field, { label: line.label, value: line.value, kind: line.kind }]);
    expect(itrReview({ ...request, purpose: "check", drafts: [...request.drafts, { id: randomUUID(), revision: 1, figures: rows }] })).toEqual({ missing: [], issues: [] });
  });

  it("files each paper by type, closes a Form 16 asked for with Form No. 130, and reads figures only from the layouts it knows", () => {
    expect(["Form No.130 2026-27.pdf", "Form 168.pdf", "XXXPZ0003X_2026_TIS.pdf"].map((name) => describeFile(name, "", null, "2026-10-26").type)).toEqual(["Form 130", "Form 168", "TIS"]);
    const ask = { period: "2027", link_hash: "x", items: [{ type: "Form 16", work: "income_tax" as const, received: [] as string[] }] };
    expect(receiveItem(ask, "Form 130", "2027", "doc1")).toBe(true);
    expect(receiveItem({ ...ask, items: [{ type: "Form 26AS", work: "income_tax", received: [] }] }, "Form 168", "2027", "doc1")).toBe(false);
    expect([["Form 26AS", "a.txt"], ["Form 26AS", "a.pdf"], ["Form 16", "a.pdf"], ["Form 130", "a.pdf"], ["AIS", "a.pdf"]].map(([document_type, name]) => readsFigures({ document_type, name, work_type: "income_tax" }))).toEqual([true, false, true, true, false]);
  });
});
