import { expect, it } from "vitest";
import { describeFile } from "@/src/lib/documents";
import { exactMapping, extractSales } from "@/src/lib/sales-register";
import { readSheet } from "@/src/lib/sheet";
import { portalParsers } from "../../worker/portal";
import { demoFiles } from "../../scripts/demo-files.mts";

// The demo firm's papers stay usable: each is filed by its name like client mail, the sales
// register reads as the official B2B sheet, and the GSTR-2B passes GSTN's layout.
it("makes demo papers InboxCA files, reads and checks like real ones", () => {
  const files = demoFiles("2026-09", "2026-10-24");
  for (const { original } of files) expect(describeFile(original, "", null, "2026-10-01T00:00:00Z")).toMatchObject({ sure: true });
  const register = files.find((file) => file.original.endsWith(".xlsx"))!;
  const rows = readSheet(Buffer.from(register.bytes), register.original, { rows: 1001, columns: 12, sheet: 2, keepEmpty: true });
  const mapping = exactMapping(rows)!;
  expect(mapping.section).toBe("b2b");
  expect(extractSales(rows, mapping).filter((line) => line.label.startsWith("Taxable Value")).map((line) => line.value)).toEqual(["186400", "342750", "97300", "128600"]);
  const twoB = files.find((file) => file.original.endsWith(".json"))!;
  expect(portalParsers[0].read(JSON.parse(new TextDecoder().decode(twoB.bytes)))?.gstin).toMatch(/^24AAPFM1234K1Z/);
  for (const file of files.filter((file) => file.original.endsWith(".pdf"))) expect(new TextDecoder("latin1").decode(file.bytes)).toContain("(Demo) Tj");
  // The sales register is the official GSTR-1 workbook filled in (worker/workbook.ts), which
  // compresses its 60 MB of sheets again: over 5 seconds when other runs load the machine.
}, 60_000);
