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
