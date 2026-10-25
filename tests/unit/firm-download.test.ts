import { expect, it } from "vitest";
import { csv, zip } from "@/src/lib/firm-download";
import { readCsv, xlsxEntries } from "@/src/lib/sheet";

it("writes CSV cells that open safely in a spreadsheet", () => {
  const text = csv(["Client", "Note"], [["Patel, Sons", 'He said "yes"'], ["=HYPERLINK(1)", null], ["-1", { kind: "a" }]]);
  expect(text).toBe('Client,Note\r\n"Patel, Sons","He said ""yes"""\r\n\'=HYPERLINK(1),\r\n\'-1,"{""kind"":""a""}"\r\n');
  expect(readCsv(text)[1]).toEqual(["Patel, Sons", 'He said "yes"']);
});

it("writes a ZIP that reads back file by file", () => {
  const files = xlsxEntries(zip([{ name: "clients.csv", text: "Client\r\nPatel Textiles\r\n" }, { name: "activity-log.csv", text: "When\r\n" }]));
  expect([...files.keys()]).toEqual(["clients.csv", "activity-log.csv"]);
  expect(files.get("clients.csv")!().toString()).toBe("Client\r\nPatel Textiles\r\n");
});

it("puts a paper's bytes in a ZIP as they are", () => {
  const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0, 255, 128]);
  const files = xlsxEntries(zip([{ name: "Patel - Form 16.pdf", text: bytes }]));
  expect([...files.get("Patel - Form 16.pdf")!()]).toEqual([...bytes]);
});
