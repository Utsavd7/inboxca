import { expect, it } from "vitest";
import { zip } from "@/src/lib/firm-download";
import { layoutDifferences, schemaLayout, workbookLayout } from "@/src/lib/official-layout";

// A small invented workbook: each sheet's rows of text cells, named in workbook order.
const workbook = (sheets: Record<string, string[][]>) => {
  const names = Object.keys(sheets);
  const cell = (text: string, column: number, row: number) => `<c r="${String.fromCharCode(65 + column)}${row}" t="inlineStr"><is><t>${text}</t></is></c>`;
  return zip([
    { name: "xl/workbook.xml", text: `<workbook><sheets>${names.map((name, at) => `<sheet name="${name}" sheetId="${at + 1}" r:id="rId${at + 1}"/>`).join("")}</sheets></workbook>` },
    // The files are numbered against the sheets' order, as Excel may save them.
    { name: "xl/_rels/workbook.xml.rels", text: `<Relationships>${names.map((_, at) => `<Relationship Target="worksheets/sheet${names.length - at}.xml" Id="rId${at + 1}" Type="worksheet"/>`).join("")}</Relationships>` },
    ...names.map((name, at) => ({ name: `xl/worksheets/sheet${names.length - at}.xml`, text: `<worksheet><sheetData>${sheets[name].map((cells, row) => `<row r="${row + 1}">${cells.map((text, column) => cell(text, column, row + 1)).join("")}</row>`).join("")}</sheetData></worksheet>` })),
  ]);
};

it("reads each sheet's headings by its name, and lists what a new workbook changes", () => {
  const before = workbookLayout(workbook({ b2b: [["Summary"], ["GSTIN of Recipient", "Invoice Number", "Rate"], ["27AAAAA0000A1Z5", "INV-1", "18"]], hsn: [["HSN", "Description"]] }), 2);
  expect(before).toEqual({ b2b: ["Summary", "GSTIN of Recipient", "Invoice Number", "Rate"], hsn: ["HSN", "Description"] });
  const after = workbookLayout(workbook({ b2b: [["Summary"], ["GSTIN/UIN of Recipient", "Invoice Number", "Rate"]], "hsn(b2b)": [["HSN", "Description"]] }), 2);
  expect(layoutDifferences(before, after)).toEqual(["In b2b, heading added: GSTIN/UIN of Recipient", "In b2b, heading removed: GSTIN of Recipient", "Sheet removed: hsn", "Sheet added: hsn(b2b)"]);
  expect(layoutDifferences(before, before)).toEqual([]);
  expect(() => workbookLayout(zip([{ name: "readme.txt", text: "Not a workbook" }]))).toThrow("No sheets");
});

it("lists a schema's field paths through its references, arrays and parts", () => {
  const schema = {
    properties: { ITR: { $ref: "#/definitions/ITR" } },
    definitions: {
      ITR: { allOf: [{ properties: { Name: { type: "string" } } }], properties: { Rows: { type: "array", items: { $ref: "#/definitions/Row" } } } },
      Row: { properties: { Amount: { type: "integer" } } },
    },
  };
  expect(schemaLayout(schema)).toEqual({ "": ["ITR.Name", "ITR.Rows.[].Amount"] });
  expect(layoutDifferences(schemaLayout(schema), { "": ["ITR.Name", "ITR.PAN"] })).toEqual(["Field added: ITR.PAN", "Field removed: ITR.Rows.[].Amount"]);
  expect(() => schemaLayout({ properties: { A: { $ref: "http://elsewhere.invalid/schema" } } })).toThrow("Unknown reference");
});
