import { columns, services, sheet, sheetType, workbook, xml } from "@/src/lib/client-sheet";
import { clientKinds, exampleClient, importServices } from "@/src/lib/clients";

// The client list template linked from Clients > Import from Excel: the headings the import
// reads, lists of the app's client types and services, and checks Excel makes as each number
// is typed (the import checks every row again). Built once, when the app is built, so there is
// no file to keep in step. Its example row is on How to fill only, never in the data.
export const dynamic = "force-static";

const choices = (column: string) => Object.keys(importServices[column].choices);

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
    check("Phone", 'type="textLength" operator="lessThanOrEqual"', "20", "The client's mobile number, for calls and WhatsApp from your team's phones.", "A phone number can have at most 20 characters."),
    check("Looked after by", 'type="textLength" operator="lessThanOrEqual"', "120", "The name or email of the person in your firm who looks after this client, as on People.", "A name can have at most 120 characters."),
    check("Tags", 'type="textLength" operator="lessThanOrEqual"', "200", "Your firm's own words for this client, separated by commas: Priority, Audit 2027. Up to 10.", "Tags can have at most 200 characters in all."),
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
    ["", "Those three are the services your firm files for the client; InboxCA makes their due dates. Left empty, you can choose them later on the Clients list."],
    ["Phone", "The client's mobile number: 10 digits, or + and the country code for a number outside India. For calls and WhatsApp from your team's phones."],
    ["Looked after by", "The name or email of the person in your firm who looks after this client, as on People. They are assigned to the client."],
    ["Tags", "Your firm's own words for the client, separated by commas, like Priority, Audit 2027. Up to 10. The Clients list filters by them."],
    [],
    ["An example row. Do not copy it into the Clients sheet."],
    columns,
    [exampleClient.name, exampleClient.kind, exampleClient.pan, exampleClient.gstin, exampleClient.email, "", "Monthly", "", "Business and no audit", exampleClient.phone, "", "Priority"],
  ];
  const bytes = workbook([
    { name: "Clients", xml: sheet([[...columns, "Only Name is needed. See the How to fill sheet."]], (_, column) => (column < columns.length ? 1 : 2), checks) },
    { name: "How to fill", xml: sheet(help, (row) => ([0, 5, help.length - 3, help.length - 2].includes(row) ? 1 : 0)) },
  ]);
  return new Response(bytes, {
    headers: {
      "Content-Type": `${sheetType}.sheet`,
      "Content-Disposition": 'attachment; filename="InboxCA client list.xlsx"',
    },
  });
}
