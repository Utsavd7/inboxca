import { zip } from "./firm-download";
import { importServices } from "./clients";

// The client list workbook, written by hand as the few XML parts Excel needs: the template
// linked from Clients > Import from Excel (app/(app)/app/clients/template) and the export of
// the firm's clients (app/(app)/app/clients/export) share these columns and this writer, so an
// export imports back as it is.
export const services = Object.keys(importServices);
export const columns = ["Name", "Client type", "PAN", "GSTIN", "Email", "TAN", ...services, "Phone", "Looked after by", "Tags"];
export const widths = [36, 24, 14, 20, 32, 14, 20, 14, 26, 18, 24, 30, 44];
export const xml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const main = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const sheetType = "application/vnd.openxmlformats-officedocument.spreadsheetml";

// A cell a spreadsheet could read as a formula (one starting with =, +, -, @, a tab or a
// return) is written as text behind an apostrophe, as Excel itself marks text; the import
// takes the apostrophe off again. A client's name or a phone with its + is data, never code.
export const safeCell = (text: string) => (/^[=+\-@\t\r]/.test(text) ? `'${text}` : text);
export const unsafeCell = (text: string) => text.replace(/^'(?=[=+\-@\t\r])/, "");

// A sheet of text. style(row, column): 1 bold, 2 grey. A sheet with checks keeps its headings
// in view and carries them.
export const sheet = (rows: string[][], style: (row: number, column: number) => number, checks = "") =>
  `${head}<worksheet ${main}>` +
  (checks && '<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>') +
  `<cols>${widths.map((width, at) => `<col min="${at + 1}" max="${at + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>` +
  rows.map((cells, row) => `<row r="${row + 1}">${cells.map((text, column) => text && `<c r="${String.fromCharCode(65 + column)}${row + 1}" s="${style(row, column)}" t="inlineStr"><is><t>${xml(text)}</t></is></c>`).join("")}</row>`).join("") +
  `</sheetData>${checks && `<dataValidations count="${columns.length}">${checks}</dataValidations>`}</worksheet>`;

// The workbook's bytes from its named sheets, the first selected.
export function workbook(sheets: { name: string; xml: string }[]) {
  const files: Record<string, string> = {
    "[Content_Types].xml": `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${sheetType}.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="${sheetType}.styles+xml"/>${sheets.map((_, at) => `<Override PartName="/xl/worksheets/sheet${at + 1}.xml" ContentType="${sheetType}.worksheet+xml"/>`).join("")}</Types>`,
    "_rels/.rels": `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `${head}<workbook ${main} xmlns:r="${rel}"><sheets>${sheets.map((one, at) => `<sheet name="${xml(one.name)}" sheetId="${at + 1}" r:id="rId${at + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, at) => `<Relationship Id="rId${at + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${at + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `${head}<styleSheet ${main}><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="11"/><color rgb="FF5B6474"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    ...Object.fromEntries(sheets.map((one, at) => [`xl/worksheets/sheet${at + 1}.xml`, one.xml])),
  };
  return new Uint8Array(zip(Object.entries(files).map(([name, text]) => ({ name, text }))));
}
