// Files from the government portals, recognised by their own contents, never by their
// names (PLAN.md 5.3.1, D39): the client and the period are read from inside the file, so
// staff choose nothing. The GST portal's JSON downloads of GSTR-2B and GSTR-2A are listed
// here, in the layout the portal publishes, each to be checked against real files in the
// pilot; income tax papers (Form 16, Form 26AS, AIS, TIS, ITR-V and others) are in
// tax-papers.ts. Anything else is not a portal file.
import { recogniseTaxText, type TaxPaper } from "./tax-papers";

export type PortalFile = { type: "GSTR-2B" | "GSTR-2A"; gstin: string; period: string } | TaxPaper;

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const SECTIONS_2A = ["b2b", "b2ba", "cdn", "cdna", "isd", "isda", "impg", "impgsez", "tds", "tcs"];

// "092026" (month and year, as the portal writes a return period) → "2026-09".
const period = (value: unknown) => (typeof value === "string" && /^(0[1-9]|1[0-2])20\d\d$/.test(value) ? `${value.slice(2)}-${value.slice(0, 2)}` : "");

// A JSON download from the GST portal, or the Form 26AS text file from TRACES. PDFs are
// read by recognisePortalPdf.
export function recognisePortalFile(bytes: Uint8Array): PortalFile | null {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return recogniseTaxText(bytes);
  }
  if (!json || typeof json !== "object") return null;
  const top = json as Record<string, unknown>;
  const data = (top.data ?? {}) as Record<string, unknown>;
  // GSTR-2B: { data: { gstin, rtnprd, docdata: { ... } } }
  if (typeof data.gstin === "string" && GSTIN.test(data.gstin) && period(data.rtnprd) && (data.docdata && typeof data.docdata === "object" || data.itcsumm && typeof data.itcsumm === "object"))
    return { type: "GSTR-2B", gstin: data.gstin, period: period(data.rtnprd) };
  // GSTR-2A: { gstin, fp, b2b: [...], cdn: [...], ... }
  if (typeof top.gstin === "string" && GSTIN.test(top.gstin) && period(top.fp) && SECTIONS_2A.some((section) => Array.isArray(top[section])))
    return { type: "GSTR-2A", gstin: top.gstin, period: period(top.fp) };
  return null;
}

// The portal files whose figures go into a draft: GSTR-2B and GSTR-2A JSON, the Form 26AS
// text file, and Form 16 or Form No. 130 as a PDF.
export const readsFigures = (paper: { document_type: string; name: string; work_type: string }) =>
  paper.work_type === "gst" && ["GSTR-2B", "GSTR-2A"].includes(paper.document_type) && /\.json$/i.test(paper.name) ||
  paper.work_type === "income_tax" && (paper.document_type === "Form 26AS" && /\.txt$/i.test(paper.name) || ["Form 16", "Form 130"].includes(paper.document_type) && /\.pdf$/i.test(paper.name));
