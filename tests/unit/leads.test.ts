import { expect, it } from "vitest";
import { checkEnquiry, convertsLeads, humanSent, leadDetails, looksLikeEnquiry, nameFromAddress, nextFollowUp, proposeLead, worksLeads } from "@/src/lib/leads";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

it("lets the owner, partners and the front desk work leads, and only the owner and partners make clients of them", () => {
  expect(["owner", "partner", "manager", "staff", "front_desk"].filter(worksLeads)).toEqual(["owner", "partner", "front_desk"]);
  expect(["owner", "partner", "front_desk"].filter(convertsLeads)).toEqual(["owner", "partner"]);
});

it("checks an enquiry as typed, and says plainly what is wrong", () => {
  const good = { name: "  Meera Shah ", email: "Meera@Example.IN ", phone: "+91 98200 12345", kind: "business", service: "gst", urgency: "now", message: "Need GST registration." };
  expect(checkEnquiry(form(good), true)).toEqual({ enquiry: { ...good, name: "Meera Shah", email: "meera@example.in", phone: "+91 98200 12345" } });
  expect(checkEnquiry(form({ ...good, name: "" }), true)).toEqual({ error: "Enter a name." });
  expect(checkEnquiry(form({ ...good, email: "" }), true)).toEqual({ error: "Enter an email address, so we can reply." });
  expect("enquiry" in checkEnquiry(form({ ...good, email: "", phone: "" }), false)).toBe(true);
  expect(checkEnquiry(form({ ...good, email: "meera" }), false)).toEqual({ error: "That email address is not valid." });
  expect(checkEnquiry(form({ ...good, phone: "call me" }), false)).toEqual({ error: "That phone number is not valid." });
  expect(checkEnquiry(form({ ...good, service: "tax_advice" }), false)).toEqual({ error: "Choose what help is needed." });
  expect(checkEnquiry(form({ ...good, message: "x".repeat(1001) }), false)).toEqual({ error: "Keep the message under 1,000 letters." });
});

it("tells a person from a bot by the hidden field and the time taken", () => {
  const now = Date.parse("2026-10-26T10:00:00Z");
  expect(humanSent("", now - 20_000, now)).toBe(true);
  expect(humanSent("https://spam.example", now - 20_000, now)).toBe(false);
  expect(humanSent("", now - 1_000, now)).toBe(false);
  expect(humanSent("", now - 2 * 86_400_000, now)).toBe(false);
});

it("follows up every 3 days, up to 4 times", () => {
  expect(nextFollowUp("2026-10-26", 0)).toBe("2026-10-29");
  expect(nextFollowUp("2026-10-30", 2)).toBe("2026-11-02");
  expect(nextFollowUp("2026-10-30", 3)).toBeNull();
});

it("spots an enquiry from a stranger by its words, and leaves out mailers and newsletters", () => {
  expect(looksLikeEnquiry("meera@example.in", { subject: "Enquiry for GST registration", text: "Hello, I am starting a shop. What are your fees for this?" })).toBe(true);
  expect(looksLikeEnquiry("ravi@example.in", { subject: "Need a CA", text: "Can you help me file my ITR this year?" })).toBe(true);
  expect(looksLikeEnquiry("ravi@example.in", { subject: "ITR filing", text: "Mujhe ITR karwana hai, kitna charge hoga?" })).toBe(true);
  expect(looksLikeEnquiry("ravi@example.in", { subject: "Lunch on Friday?", text: "Are you free on Friday?" })).toBe(false);
  expect(looksLikeEnquiry("noreply@bank.example", { subject: "Your enquiry", text: "Can you help? Quotation attached for GST." })).toBe(false);
  expect(looksLikeEnquiry("offers@shop.example", { subject: "Quotation for your services", text: "Best prices on GST software. Unsubscribe here." })).toBe(false);
});

it("proposes a lead from an email: the sender's name, the help asked for and the kind", () => {
  expect(proposeLead("meera.shah@example.in", "", { subject: "GST registration enquiry", snippet: "for my private limited company" })).toEqual({ name: "Meera Shah", service: "gst", kind: "company" });
  expect(proposeLead("ms1987@example.in", "Meera S", { subject: "Need help", snippet: "with my income tax return" })).toEqual({ name: "Meera S", service: "itr", kind: "individual" });
  expect(nameFromAddress("12345@example.in")).toBe("12345@example.in");
});

it("reads a lead's details, keeping only what it should hold", () => {
  expect(leadDetails({ service: "gst", follow_up_on: "2026-10-30", other: "x" })).toEqual({ service: "gst", follow_up_on: "2026-10-30" });
  expect(leadDetails({ service: "unknown" })).toEqual({});
  expect(leadDetails(null)).toEqual({});
});
