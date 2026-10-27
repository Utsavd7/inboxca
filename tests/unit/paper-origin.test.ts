import { describe, expect, it } from "vitest";
import { originOf } from "@/src/lib/paper-origin";

// How each paper says it got into the drive, from what InboxCA recorded of it.
describe("where a paper came from", () => {
  const paper = { id: "p", client_id: "c", name: "Mehta Traders - Purchase bills - Sep 2026.pdf", status: "filed", work_type: "gst", document_type: "Purchase bills", period_key: "2026-09", received_at: "2026-10-26T05:12:00Z", email_event_id: null, clients: { name: "Mehta Traders" } };

  it("names the email's sender, or the client, and links the email only for those who may open it", () => {
    const mailed = { ...paper, email_event_id: "e" };
    expect(originOf(mailed, { sender: "Rajesh Desai", mail: true })).toMatchObject({ short: "Email from Rajesh Desai", how: "Saved by InboxCA from Rajesh Desai's email", mail: "e" });
    expect(originOf(mailed, {})).toMatchObject({ how: "Saved by InboxCA from Mehta Traders' email" });
    expect(originOf(mailed, {}).mail).toBeUndefined();
  });
});
