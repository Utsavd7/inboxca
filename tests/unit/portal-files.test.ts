import { describe, expect, it } from "vitest";
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
