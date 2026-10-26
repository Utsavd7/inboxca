import {expect,it} from "vitest";
import {emailTemplates,TEMPLATE_VERSION} from "@/src/lib/email-templates";
import {mailboxLink} from "@/src/lib/mailbox";
it("renders the checked English wording from named facts only",()=>{
  expect(TEMPLATE_VERSION).toBe(1);
  expect(emailTemplates.received("Invented Client","Test Firm",[{type:"Sales bills",period:"2026-09",toCheck:false}]).text).toContain("- Sales bills, Sep 2026");
  expect(emailTemplates.paper("Invented Client","Test Firm","ITR-V","https://example.test/s/invented",true,false).text).toContain("choose Email me a code");
  // The subject names the paper's type and period, not the drive's file name.
  expect(emailTemplates.paper("Invented Client","Test Firm","Invented Client - Form 16 - FY 2025-26 - v1.pdf","https://example.test/s/invented",false,false,{type:"Form 16",period:"2026"}).subject).toBe("Form 16 for FY 2025-26 from Test Firm");
  expect(emailTemplates.request("Invented Client","Test Firm","2026-09",[{type:"Bank statement"}],"https://example.test/u/invented").text).toContain("- Bank statement");
  const receipt=emailTemplates.receipt("Invented Client","Test Firm","2026-09",[{type:"Sales bills",received:["a","b"]},{type:"Bank statement",received:[]}]);
  expect(receipt.text).toContain("We have received these papers for Sep 2026:\n- Sales bills: 2 files\n\nStill needed:\n- Bank statement");
  expect(receipt.text).not.toMatch(/InboxCA|http/);
  expect(emailTemplates.receipt("Invented Client","Test Firm","",[{type:"Sales bills",received:["a"]}]).text).toContain("- Sales bills: 1 file\n\nThat is everything we asked for.");
  expect(emailTemplates.code("123456","Test Firm").text).toContain("Your code is 123456."); // ggignore: an invented one-time code for this test.
});
it("opens Gmail by Message-ID and never builds an arbitrary provider URL",()=>{
  const link=mailboxLink("imap.gmail.com","office@invented.test","<invented+id@example.test>")!;
  expect(new URL(link).origin).toBe("https://mail.google.com");
  expect(new URL(link).searchParams.get("authuser")).toBe("office@invented.test");
  expect(decodeURIComponent(new URL(link).hash)).toContain("rfc822msgid:invented+id@example.test");
  expect(mailboxLink("untrusted.example","office@invented.test","https://untrusted.example")).toBeNull();
});
