import {expect,it} from "vitest";
import {emailTemplates,TEMPLATE_VERSION} from "@/src/lib/email-templates";
import {mailboxLink} from "@/src/lib/mailbox";
it("renders the checked English wording from named facts only",()=>{
  expect(TEMPLATE_VERSION).toBe(1);
  expect(emailTemplates.answer("received","Invented Client","Test Firm",["- Sales bills: saved under GST, Sep 2026"]).text).toBe("Dear Invented Client,\n\nThank you. We received these papers:\n- Sales bills: saved under GST, Sep 2026\n\nTest Firm");
  expect(emailTemplates.paper("Invented Client","Test Firm","ITR-V","https://example.test/s/invented",true,false).text).toContain("choose Email me a code");
  // The subject names the paper's type and period, not the drive's file name.
  expect(emailTemplates.paper("Invented Client","Test Firm","Invented Client - Form 16 - FY 2025-26 - v1.pdf","https://example.test/s/invented",false,false,{type:"Form 16",period:"2026"}).subject).toBe("Form 16 for FY 2025-26 from Test Firm");
  // Papers are asked for by email and come back as attachments: no link, no InboxCA.
  const request=emailTemplates.request("Invented Client","Test Firm","2026-09",[{type:"Bank statement"}]);
  expect(request.text).toContain("Please reply to this email with these documents attached for Sep 2026:\n- Bank statement");
  expect(request.text).not.toMatch(/InboxCA|http/);
  expect(emailTemplates.openLink("Invented Client","Test Firm").text).toContain("set the link to anyone with the link");
  expect(emailTemplates.code("123456","Test Firm").text).toContain("Your code is 123456."); // ggignore: an invented one-time code for this test.
});
it("opens Gmail by Message-ID and never builds an arbitrary provider URL",()=>{
  const link=mailboxLink("imap.gmail.com","office@invented.test","<invented+id@example.test>")!;
  expect(new URL(link).origin).toBe("https://mail.google.com");
  expect(new URL(link).searchParams.get("authuser")).toBe("office@invented.test");
  expect(decodeURIComponent(new URL(link).hash)).toContain("rfc822msgid:invented+id@example.test");
  expect(mailboxLink("untrusted.example","office@invented.test","https://untrusted.example")).toBeNull();
});
