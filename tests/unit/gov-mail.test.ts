import { randomInt } from "node:crypto";
import { describe, expect, it } from "vitest";
import { filedReturn, officialKind, officialSender, taxNumbersIn } from "@/src/lib/gov-mail";

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
    expect(taxNumbersIn("PAN: AAPFU0939F. GSTIN 27AAPFU0939F1ZV. TAN MUMA12345B. Not a PAN: ABCDE12345")).toEqual({ gstins: ["27AAPFU0939F1ZV"], pans: ["AAPFU0939F"], tans: ["MUMA12345B"] });
    expect(officialKind("Intimation u/s 143(1)", "")).toBe("notice");
    expect(officialKind("ITR has been successfully e-Verified", "Your return for AY 2026-27 is e-verified.")).toBe("verified");
    expect(officialKind("ITR-V Acknowledgement", "Your return was filed successfully.")).toBe("acknowledgement");
    expect(officialKind("Your GSTR-1 has been filed", "ARN AA270926123456X")).toBe("acknowledgement");
    expect(officialKind("Refund credited", "Your refund has been credited.")).toBe("other");
  });

  // A misread number or period would mark the wrong return filed: only official formats, and only
  // when the mail names exactly one.
  it("reads a filing acknowledgement's return, period and number only when they are unambiguous", () => {
    const digits = (length: number) => Array.from({ length }, () => randomInt(10)).join("");
    const ack = digits(15), other = digits(15);
    const itr = filedReturn("income_tax", "ITR-1 Acknowledgement for Assessment Year 2026-27", `PAN AAPFU0939F\nAcknowledgement Number: ${ack}\nDate of filing: 31-Jul-2026`);
    expect(itr && { form: itr.form.source, period: itr.period, number: itr.number }).toEqual({ form: "^ITR1$", period: "2026", number: ack });
    expect(filedReturn("income_tax", "ITR-V for AY 2026-27", `Acknowledgement No. ${ack}, acknowledgement number ${other}`)?.number).toBe("");
    expect(filedReturn("income_tax", "ITR-V for AY 2026-27", `Acknowledgement Number ${digits(16)}`)?.number).toBe("");
    expect(filedReturn("income_tax", "ITR-V for AY 2026-27", `Reference ${ack}`)?.number).toBe("");
    expect(filedReturn("income_tax", "ITR-1 and ITR-4 filed", "AY 2026-27")).toBeNull();
    const tds = filedReturn("income_tax", "TDS statement accepted", `TAN MUMA12345B, Q2 2026-27, token number ${ack}`);
    expect(tds && { form: tds.form.source, period: tds.period, number: tds.number }).toEqual({ form: "^TDS\\d{3}$", period: "2026-09", number: ack });
    // No official text gives the ARN's format: it is never read.
    const gst = filedReturn("gst", "GSTR-3B filed for October 2026", "ARN AA270926123456X. Filed on 12/11/2026.");
    expect(gst && { form: gst.form.source, period: gst.period, number: gst.number }).toEqual({ form: "^GSTR3B$", period: "2026-10", number: "" });
    expect(filedReturn("gst", "GSTR-3B filed", "Return period October 2026, September 2026")?.period).toBe("");
    expect(filedReturn("gst", "GSTR-1 and GSTR-3B filed", "October 2026")).toBeNull();
  });
});
