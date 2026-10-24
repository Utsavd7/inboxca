import { describe, expect, it } from "vitest";
import { receiveItem, type DocumentRequest } from "@/src/lib/checklists";
import { recognisePortalFile } from "@/src/lib/portal-files";

const file = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

// Invented downloads in the GST portal's layout; a file is known by what is inside it.
describe("portal files", () => {
  it("reads the GSTIN and month from a GSTR-2B", () => {
    expect(recognisePortalFile(file({ chksum: "x", data: { gstin: "27AAPFU0939F1ZV", rtnprd: "092026", version: "1.0", docdata: { b2b: [] } } }))).toEqual({
      type: "GSTR-2B",
      gstin: "27AAPFU0939F1ZV",
      period: "2026-09",
    });
  });
  it("reads the GSTIN and month from a GSTR-2A", () => {
    expect(recognisePortalFile(file({ gstin: "27AAPFU0939F1ZV", fp: "082026", b2b: [] }))).toEqual({ type: "GSTR-2A", gstin: "27AAPFU0939F1ZV", period: "2026-08" });
  });
  it("takes nothing else for a portal file, whatever its name says", () => {
    expect(recognisePortalFile(file({ gstin: "27AAPFU0939F1ZV", fp: "132026", b2b: [] }))).toBeNull();
    expect(recognisePortalFile(file({ data: { gstin: "not a gstin", rtnprd: "092026", docdata: {} } }))).toBeNull();
    expect(recognisePortalFile(new TextEncoder().encode("%PDF-1.4 GSTR-2B"))).toBeNull();
  });
});

describe("a dropped portal file and what was asked for", () => {
  const ask = (period: string, ...types: string[]): DocumentRequest => ({ period, link_hash: "x", items: types.map((type) => ({ type, work: "other", received: [] })) });
  it("closes the open item of the same name, however it was spelled, for the file's month or no month", () => {
    const monthly = ask("2026-09", "Sales bills", "gstr 2B");
    expect(receiveItem(monthly, "GSTR-2B", "2026-09", "doc1")).toBe(true);
    expect(monthly.items.map((item) => item.received)).toEqual([[], ["doc1"]]);
    expect(receiveItem(ask("", "GSTR-2B"), "GSTR-2B", "2026-09", "doc1")).toBe(true);
  });
  it("leaves another month, another file and an item already in", () => {
    expect(receiveItem(ask("2026-08", "GSTR-2B"), "GSTR-2B", "2026-09", "doc1")).toBe(false);
    expect(receiveItem(ask("2026-09", "GSTR-2A"), "GSTR-2B", "2026-09", "doc1")).toBe(false);
    const done = ask("2026-09", "GSTR-2B");
    done.items[0].received.push("old");
    expect(receiveItem(done, "GSTR-2B", "2026-09", "doc1")).toBe(false);
  });
});
