import { clientKinds, exampleClient, importServices } from "@/src/lib/clients";
import { zip } from "@/src/lib/firm-download";

// The client list template linked from Clients > Import from Excel: the headings the import
// reads, lists of the app's client types and services, and checks Excel makes as each number
// is typed (the import checks every row again). Built once, when the app is built, so there is
// no file to keep in step. Its example row is on How to fill only, never in the data.
export const dynamic = "force-static";

const services = Object.keys(importServices);
const choices = (column: string) => Object.keys(importServices[column].choices);
const columns = ["Name", "Client type", "PAN", "GSTIN", "Email", "TAN", ...services];
const widths = [36, 24, 14, 20, 32, 14, 20, 14, 26, 44];
const xml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const main = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const type = "application/vnd.openxmlformats-officedocument.spreadsheetml";

// A sheet of text. style(row, column): 1 bold, 2 grey. The data sheet keeps its headings in
// view and carries the checks.
const sheet = (rows: string[][], style: (row: number, column: number) => number, checks = "") =>
  `${head}<worksheet ${main}>` +
  (checks && '<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>') +
  `<cols>${widths.map((width, at) => `<col min="${at + 1}" max="${at + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>` +
  rows.map((cells, row) => `<row r="${row + 1}">${cells.map((text, column) => text && `<c r="${String.fromCharCode(65 + column)}${row + 1}" s="${style(row, column)}" t="inlineStr"><is><t>${xml(text)}</t></is></c>`).join("")}</row>`).join("") +
  `</sheetData>${checks && `<dataValidations count="${columns.length}">${checks}</dataValidations>`}</worksheet>`;

// One column's check on rows 2 to 2,001 (an import takes 2,000), with what Excel shows on the
// cell and when a value fails. A formula is written for row 2; Excel moves it down each row.
const check = (column: string, rule: string, formula: string, prompt: string, error: string) => {
  const letter = String.fromCharCode(65 + columns.indexOf(column));
  return `<dataValidation ${rule} allowBlank="1" showInputMessage="1" showErrorMessage="1" promptTitle="${column}" prompt="${xml(prompt)}" errorTitle="${column}" error="${xml(error)}" sqref="${letter}2:${letter}2001"><formula1>${xml(formula)}</formula1></dataValidation>`;
};
const capital = (at: string) => `ABS(CODE(${at})-77.5)<13`;

export function GET() {
  const kinds = Object.values(clientKinds);
  const checks = [
    check("Name", 'type="textLength" operator="lessThanOrEqual"', "200", "Needed on every row: the client's name as it should show in InboxCA.", "A name can have at most 200 characters."),
    check("Client type", 'type="list"', `"${kinds.join(",")}"`, "Choose from the list. Left empty, InboxCA uses Business when there is a GSTIN, else Individual.", "Choose a client type from the list."),
    check("PAN", 'type="custom"', `AND(LEN(C2)=10,TEXT(MID(C2,6,4)*1,"0000")=MID(C2,6,4),${["C2", "MID(C2,2,1)", "MID(C2,3,1)", "MID(C2,4,1)", "MID(C2,5,1)", "RIGHT(C2)"].map(capital).join(",")})`,
      `10 characters in capitals: 5 letters, 4 digits and a letter, like ${exampleClient.pan}. Leave it empty when you give a GSTIN.`, "That PAN is not valid. A PAN is 5 letters, 4 digits and a letter, in capitals."),
    check("GSTIN", 'type="custom"', 'AND(LEN(D2)=15,EXACT(D2,UPPER(D2)),TEXT(LEFT(D2,2)*1,"00")=LEFT(D2,2),TEXT(MID(D2,8,4)*1,"0000")=MID(D2,8,4),MID(D2,14,1)="Z",OR(C2="",MID(D2,3,10)=C2))',
      `15 characters in capitals, like ${exampleClient.gstin}. Characters 3 to 12 are the PAN.`, "That GSTIN is not valid. Check it for a typing mistake, and that characters 3 to 12 are the PAN."),
    check("Email", 'type="custom"', 'AND(FIND("@",E2)>1,ISNUMBER(FIND(".",E2,FIND("@",E2)+2)),RIGHT(E2)<>".",LEN(SUBSTITUTE(E2,"@",""))=LEN(E2)-1,ISERR(FIND(" ",E2)))',
      "The address InboxCA writes to for this client.", "That email address is not valid."),
    check("TAN", 'type="custom"', `AND(LEN(F2)=10,TEXT(MID(F2,5,5)*1,"00000")=MID(F2,5,5),${["F2", "MID(F2,2,1)", "MID(F2,3,1)", "MID(F2,4,1)", "RIGHT(F2)"].map(capital).join(",")})`,
      "10 characters in capitals: 4 letters, 5 digits and a letter. Needed for TDS returns.", "That TAN is not valid. A TAN is 4 letters, 5 digits and a letter, in capitals."),
    ...services.map((column) => check(column, 'type="list"', `"${choices(column).join(",")}"`, "Choose from the list what your firm files for this client. Left empty, InboxCA adds none.", `Choose ${column} from the list.`)),
  ].join("");
  const help = [
    ["How to fill the client list"],
    ["Put one client on each row of the Clients sheet, from row 2. Keep row 1 as it is."],
    ["Only Name is needed. Fill the other columns when you have them, then upload the file in InboxCA: Clients, Import from Excel."],
    ["InboxCA checks every row and shows you the result before it adds anyone."],
    [],
    ["Column", "What to write"],
    ["Name", "The client's name as it should show in InboxCA."],
    ["Client type", `Choose from the list: ${kinds.join(", ")}. Left empty, InboxCA uses Business when there is a GSTIN, else Individual.`],
    ["PAN", "10 characters in capitals: 5 letters, 4 digits and a letter. You can leave it empty when you give a GSTIN."],
    ["GSTIN", "15 characters in capitals. Characters 3 to 12 are the PAN."],
    ["Email", "The address InboxCA writes to for this client."],
    ["TAN", "10 characters in capitals: 4 letters, 5 digits and a letter. Needed for TDS returns."],
    ["GST returns", `Choose from the list: ${choices("GST returns").join(", ")}. Monthly is GSTR-1 and GSTR-3B each month; Quarterly (QRMP) is both each quarter, with the GST payment for its first two months; Composition is CMP-08 and GSTR-4. Needs the GSTIN.`],
    ["TDS returns", "Yes adds the quarterly TDS returns and the monthly TDS payments. Needs the TAN."],
    ["Income tax return", `Choose from the list: ${choices("Income tax return").join(", ")}. Each has its own due date. Needs the PAN.`],
    ["", "The last three are the services your firm files for the client; InboxCA makes their due dates. Left empty, you can choose them later on the Clients list."],
    [],
    ["An example row. Do not copy it into the Clients sheet."],
    columns,
    [exampleClient.name, exampleClient.kind, exampleClient.pan, exampleClient.gstin, exampleClient.email, "", "Monthly", "", "Business and no audit"],
  ];
  const files: Record<string, string> = {
    "[Content_Types].xml": `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${type}.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="${type}.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${type}.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="${type}.worksheet+xml"/></Types>`,
    "_rels/.rels": `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `${head}<workbook ${main} xmlns:r="${rel}"><sheets><sheet name="Clients" sheetId="1" r:id="rId1"/><sheet name="How to fill" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `${head}<styleSheet ${main}><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="11"/><color rgb="FF5B6474"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    "xl/worksheets/sheet1.xml": sheet([[...columns, "Only Name is needed. See the How to fill sheet."]], (_, column) => (column < columns.length ? 1 : 2), checks),
    "xl/worksheets/sheet2.xml": sheet(help, (row) => ([0, 5, help.length - 3, help.length - 2].includes(row) ? 1 : 0)),
  };
  return new Response(new Uint8Array(zip(Object.entries(files).map(([name, text]) => ({ name, text })))), {
    headers: {
      "Content-Type": `${type}.sheet`,
      "Content-Disposition": 'attachment; filename="InboxCA client list.xlsx"',
    },
  });
}
