import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeWorkbook } from "../../worker/workbook";

// An invented copy of the shipped GSTR-1 v2.2 workbook, saved again: the same sheets and
// headings, a different SHA-256 (the same one every time). Not a government release.
export const shippedWorkbook = "gstr1-v2.2/GSTR1_Excel_Workbook_Template_V2.2.xlsx";
export const resavedWorkbook = () => writeWorkbook(readFileSync(`reference/official/${shippedWorkbook}`), new Map());
export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
