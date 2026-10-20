import {expect,it} from "vitest";
import {emailTemplates,TEMPLATE_VERSION} from "@/src/lib/email-templates";
import {mailboxLink} from "@/src/lib/mailbox";
it("renders the checked English wording from named facts only",()=>{
  expect(TEMPLATE_VERSION).toBe(1);
  expect(emailTemplates.received("Invented Client","Test Firm",[{type:"Sales bills",period:"2026-09",toCheck:false}]).text).toContain("- Sales bills, Sep 2026");
  expect(emailTemplates.paper("Invented Client","Test Firm","ITR-V","https://example.test/s/invented",true,false).text).toContain("one-time code");
  expect(emailTemplates.request("Invented Client","Test Firm","2026-09",[{type:"Bank statement"}],"https://example.test/u/invented").text).toContain("- Bank statement");
  expect(emailTemplates.code("123456","Test Firm").text).toContain("Your code is 123456."); // ggignore: an invented one-time code for this test.
});
it("opens Gmail by Message-ID and never builds an arbitrary provider URL",()=>{
  const link=mailboxLink("imap.gmail.com","office@invented.test","<invented+id@example.test>")!;
  expect(new URL(link).origin).toBe("https://mail.google.com");
  expect(new URL(link).searchParams.get("authuser")).toBe("office@invented.test");
  expect(decodeURIComponent(new URL(link).hash)).toContain("rfc822msgid:invented+id@example.test");
  expect(mailboxLink("untrusted.example","office@invented.test","https://untrusted.example")).toBeNull();
});
