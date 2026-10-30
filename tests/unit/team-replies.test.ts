import { expect, it } from "vitest";
import { suggestedReply } from "@/src/lib/team-replies";
import { replyReasons } from "@/src/lib/triage";

const names = { name: "Meera Shah", client: "Invented Traders", firm: "Test Firm" };

it("suggests a short reply for every reason an email waits, with the names filled in and nothing invented", () => {
  // No reply is suggested for a tax portal's mail: its address takes none.
  const replies = Object.keys(replyReasons).filter((reason) => reason !== "client_unclear" && !reason.startsWith("government_")).map((reason) => suggestedReply(reason, names));
  // Each reason has its own words.
  expect(new Set(replies).size).toBe(replies.length);
  for (const reply of replies) {
    expect(reply).toMatch(/^Dear Meera Shah,\n\n[^\n]+\n\nRegards,\nTest Firm$/);
    // No figures, dates, dashes or exclamation marks it could not know or that the firm's words avoid.
    expect(reply).not.toMatch(/\d|[–—!]/);
  }
  expect(suggestedReply("not_allowed", names)).toContain("we send the papers of Invented Traders only to the email addresses on our records. Please ask Invented Traders to write to us");
  // A reason InboxCA does not know yet, or none, gets the general reply.
  expect(suggestedReply("something_new", names)).toBe(suggestedReply("no_rule", names));
  expect(suggestedReply(null, names)).toBe(suggestedReply("no_rule", names));
});

it("names the paper and year the rules read in the email, or none", () => {
  expect(suggestedReply("record_not_found", { ...names, paper: { types: ["ITR-V", "Acknowledgement"], period: "2026" } })).toContain("We could not find the ITR-V for FY 2025-26 in our records just now.");
  expect(suggestedReply("record_internal", { ...names, paper: { types: ["Balance sheet"], period: "" } })).toContain("We have your request for the Balance sheet.");
  expect(suggestedReply("record_not_found", { ...names, paper: { types: [], period: "2026" } })).toContain("We could not find the paper you asked for in our records");
});
