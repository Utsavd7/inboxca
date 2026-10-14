import { afterEach, describe, expect, it, vi } from "vitest";
import { log, redact } from "@/src/lib/logger";

describe("log redaction", () => {
  it("masks identifiers wherever they appear", () => {
    const line = redact(
      "Client ABCDE1234F, GSTIN 27ABCDE1234F1Z5, Aadhaar 1234 5678 9012, phone +91 9876543210, mail ca@firm.in",
    );
    expect(line).toBe(
      "Client [pan], GSTIN [gstin], Aadhaar [aadhaar], phone [phone], mail [email]",
    );
  });

  it("drops content fields whole, at any depth", () => {
    const out = redact({
      firmId: "f1",
      email: { subject: "Purchase bills", body: "Please find attached" },
      attachments: [{ filename: "IMG_2291.pdf", size: 1200 }],
      auth: { token: "abc", Authorization: "Bearer x" },
    });
    expect(out).toEqual({
      firmId: "f1",
      email: "[redacted]",
      attachments: [{ filename: "[redacted]", size: 1200 }],
      auth: { token: "[redacted]", Authorization: "[redacted]" },
    });
  });

  it("keeps errors readable without their secrets", () => {
    expect(redact(new Error("Mailbox ca@firm.in refused"))).toEqual({
      name: "Error",
      message: "Mailbox [email] refused",
    });
  });

  it("leaves ordinary operational fields alone", () => {
    expect(redact({ jobId: "j-42", attempt: 2, ok: true, ms: 18 })).toEqual({
      jobId: "j-42",
      attempt: 2,
      ok: true,
      ms: 18,
    });
  });
});

describe("log lines", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes one JSON line with the event and redacted fields", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    log.info("mail.filed", { firmId: "f1", subject: "Bank statement", from: "ca@firm.in" });
    const line = JSON.parse(out.mock.calls[0][0] as string);
    expect(line).toMatchObject({
      level: "info",
      event: "mail.filed",
      firmId: "f1",
      subject: "[redacted]",
      from: "[email]",
    });
  });

});
