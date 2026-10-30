import { describe, expect, it } from "vitest";
import { officialKind, officialSender, taxNumbersIn } from "@/src/lib/gov-mail";

// Mail from the tax portals is trusted only when the mailbox's own Authentication-Results
// say SPF or DKIM passed for the official domain: a forged From alone is ordinary mail.
describe("official sender check", () => {
  const gmail = "mx.google.com; dkim=pass header.i=@incometax.gov.in header.s=sel header.b=abc; spf=pass (google.com: domain of donotreply@incometax.gov.in designates 1.2.3.4 as permitted sender) smtp.mailfrom=donotreply@incometax.gov.in; dmarc=pass";
  const outlook = "spf=pass (sender IP is 1.2.3.4) smtp.mailfrom=gst.gov.in; dkim=pass (signature was verified) header.d=gst.gov.in;dmarc=pass action=none header.from=gst.gov.in";
  it("trusts the portals' domains and their subdomains once SPF or DKIM passed for them", () => {
    expect(officialSender("donotreply@incometax.gov.in", gmail)).toBe("income_tax");
    expect(officialSender("intimations@cpc.incometax.gov.in", "spf=pass smtp.mailfrom=cpc.incometax.gov.in")).toBe("income_tax");
    expect(officialSender("donotreply@gst.gov.in", outlook)).toBe("gst");
    expect(officialSender("contactus@tdscpc.gov.in", "dkim=pass header.d=tdscpc.gov.in")).toBe("income_tax");
  });
  it("treats a forged, failed or lookalike sender as ordinary mail", () => {
    expect(officialSender("donotreply@incometax.gov.in", "")).toBeNull();
    expect(officialSender("donotreply@incometax.gov.in", "spf=fail smtp.mailfrom=incometax.gov.in; dkim=none")).toBeNull();
    expect(officialSender("donotreply@incometax.gov.in", "dkim=pass header.d=evil.test; spf=pass smtp.mailfrom=evil.test")).toBeNull();
    expect(officialSender("donotreply@incometax.gov.in", "dkim=pass header.d=evil.test header.i=@incometax.gov.in")).toBeNull();
    expect(officialSender("donotreply@incometax.gov.in.evil.test", gmail)).toBeNull();
    expect(officialSender("donotreply@incometaxgov.in", "spf=pass smtp.mailfrom=incometaxgov.in")).toBeNull();
    expect(officialSender("accounts@shah.in", "spf=pass smtp.mailfrom=shah.in")).toBeNull();
  });
  it("finds the checked PANs and GSTINs an official mail names, and sorts the mail by its words", () => {
    expect(taxNumbersIn("PAN: AAPFU0939F. GSTIN 27AAPFU0939F1ZV. Not a PAN: ABCDE12345")).toEqual({ gstins: ["27AAPFU0939F1ZV"], pans: ["AAPFU0939F"] });
    expect(officialKind("Intimation u/s 143(1)", "")).toBe("notice");
    expect(officialKind("ITR has been successfully e-Verified", "Your return for AY 2026-27 is e-verified.")).toBe("verified");
    expect(officialKind("ITR-V Acknowledgement", "Your return was filed successfully.")).toBe("acknowledgement");
    expect(officialKind("Your GSTR-1 has been filed", "ARN AA270926123456X")).toBe("acknowledgement");
    expect(officialKind("Refund credited", "Your refund has been credited.")).toBe("other");
  });
});
