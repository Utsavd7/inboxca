import { describe, expect, it } from "vitest";
import { originOf, waitsFor } from "@/src/lib/paper-origin";

// How each paper says it got into the drive, from what InboxCA recorded of it.
describe("where a paper came from", () => {
  const paper = { id: "p", client_id: "c", name: "Mehta Traders - Purchase bills - Sep 2026.pdf", status: "filed", work_type: "gst", document_type: "Purchase bills", period_key: "2026-09", received_at: "2026-10-26T05:12:00Z", email_event_id: null, clients: { name: "Mehta Traders" } };
  const line = (action: string, actor_id: string | null, details: unknown = {}) => ({ action, actor_id, details });

  it("names the email's sender, or the client, and links the email only for those who may open it", () => {
    const mailed = { ...paper, email_event_id: "e" };
    expect(originOf(mailed, { sender: "Rajesh Desai", mail: true })).toMatchObject({ short: "Email from Rajesh Desai", how: "Saved by InboxCA from Rajesh Desai's email", mail: "e" });
    expect(originOf(mailed, {})).toMatchObject({ how: "Saved by InboxCA from Mehta Traders' email" });
    expect(originOf(mailed, {}).mail).toBeUndefined();
  });

  it("names who uploaded, added or filed it; an upload with no person came through the client's link", () => {
    expect(originOf(paper, { line: line("document.uploaded", "u"), by: "Anita" }).how).toBe("Uploaded by Anita");
    expect(originOf(paper, { line: line("document.uploaded", "u", { from: "portal" }), by: "Anita" }).how).toBe("Added as a portal file by Anita");
    expect(originOf({ ...paper, document_type: "GSTR-2B", name: "x.json" }, { line: line("document.uploaded", "u"), by: "Anita" }).how).toBe("Added as a portal file by Anita");
    expect(originOf(paper, { line: line("document.uploaded", null) }).how).toBe("Sent by the client through their upload link");
    expect(originOf(paper, { line: line("document.filed", "u", { from: "drive" }), by: "Anita" }).how).toBe("Found in the drive and saved by Anita");
    expect(originOf(paper, { line: line("document.added", "u", { kind: "acknowledgement" }), by: "Anita" }).how).toBe("Acknowledgement added by Anita");
    expect(originOf({ ...paper, prepared: "GSTR1" }, {}).how).toBe("Prepared in InboxCA");
  });

  it("says when, in India, with the old place for a paper moved in from old files", () => {
    expect(originOf(paper, { imported: true, from: "Old files/Mehta/bills.pdf" })).toMatchObject({ short: "From your old files", how: "Moved here from your old files", from: "Old files/Mehta/bills.pdf" });
    expect(originOf(paper, {})).toMatchObject({ how: "From the drive", at: expect.stringMatching(/^26 Oct( 2026)?, 10:42$/) });
  });

  it("says why a paper waits under To check", () => {
    expect(waitsFor({ document_type: "Document", period_key: "" }, false)).toBe("InboxCA could not tell its type and period");
    expect(waitsFor({ document_type: "Ledger", period_key: "" }, false)).toBe("InboxCA could not tell its period");
    expect(waitsFor({ document_type: "Document", period_key: "2026-09" }, false)).toBe("InboxCA could not tell its type");
    expect(waitsFor({ document_type: "Ledger", period_key: "2026-09" }, true)).toBe("the same file came in before");
    expect(originOf({ ...paper, status: "to_check" }, { twin: true }).why).toBe("the same file came in before");
    expect(originOf(paper, {}).why).toBeUndefined();
  });
});
