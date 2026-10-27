import { describe, expect, it } from "vitest";
import { replySubject, signMail, stripQuoted, suggestPapers, threadKeys, verifyMail } from "@/src/lib/mail-view";

describe("reading a message", () => {
  const text = "Sir,\n\nAttaching the September bills.\nSales register on Monday.\n\nRajesh\n\nOn Mon, 20 Oct 2026 at 10:00, Invented CA <office@invented.test> wrote:\n> Please send the bills.\n> Thanks";
  it("leaves out the earlier messages it quotes", () => {
    expect(stripQuoted(text)).toBe("Sir,\n\nAttaching the September bills.\nSales register on Monday.\n\nRajesh");
    expect(stripQuoted("Thanks\n> quoted line\nmore\n-----Original Message-----\nold")).toBe("Thanks\nmore");
  });
  it("threads a reply under every earlier Message-ID, and says Re once", () => {
    expect(threadKeys("<c@x>", "<b@x>", ["<a@x>", "<b@x>"])).toEqual(["<a@x>", "<b@x>", "<c@x>"]);
    expect(threadKeys("<a@x>", "", [])).toEqual(["<a@x>"]);
    expect(threadKeys("<z@x>", "", Array.from({ length: 30 }, (_, n) => `<${n}@x>`))).toHaveLength(20);
    expect(replySubject("GSTR-3B query")).toBe("Re: GSTR-3B query");
    expect(replySubject("RE: GSTR-3B query")).toBe("RE: GSTR-3B query");
  });
});

it("suggests the client's papers an email asks for, the asked period first", () => {
  const papers = [
    { id: "a", document_type: "Form 16", period_key: "2025" },
    { id: "b", document_type: "Form 16", period_key: "2026" },
    { id: "c", document_type: "Bank statement", period_key: "2026-09" },
    { id: "d", document_type: "Document", period_key: "" },
  ];
  const types = ["Bank statement", "Form 16", "Document"];
  expect(suggestPapers("Please send Form 16 for FY 2024-25", papers, { types: ["Form 16"], period: "2025" }, types).map((paper) => paper.id)).toEqual(["a", "b"]);
  expect(suggestPapers("Need the bank statement for September", papers, { types: [], period: "2026-09" }, types).map((paper) => paper.id)).toEqual(["c"]);
  expect(suggestPapers("Can we meet next week? Document attached", papers, { types: [], period: "" }, types)).toEqual([]);
});

describe("a live mail read for the file worker", () => {
  const secret = "invented-worker-test-secret";
  const request = (change: Record<string, unknown> = {}) =>
    JSON.stringify({ firm: "firm", expires: Math.floor(Date.now() / 1000) + 60, address: "office@invented.test", password: "invented", server: { host: "127.0.0.1", port: 3143 }, op: "list", ask: { inbox: ["<a@x>"], sent: { limit: 30 } }, ...change });
  it("is accepted only signed, fresh, for its own read and in bounds", async () => {
    const body = request();
    expect((await verifyMail(body, await signMail(body, secret), secret, "list")).ask).toEqual({ inbox: ["<a@x>"], sent: { limit: 30 } });
    await expect(verifyMail(body, await signMail(body, "another secret"), secret, "list")).rejects.toThrow("Not allowed");
    await expect(verifyMail(body, await signMail(body, secret), secret, "thread")).rejects.toThrow("Not allowed");
    for (const change of [{ expires: Math.floor(Date.now() / 1000) - 1 }, { expires: Math.floor(Date.now() / 1000) + 600 }, { ask: { inbox: Array(501).fill("<a@x>"), sent: null } }, { ask: { inbox: [], sent: { limit: 51 } } }, { op: "thread", ask: { box: "drafts", messageId: "<a@x>" } }]) {
      const bad = request(change);
      await expect(verifyMail(bad, await signMail(bad, secret), secret, String(change.op ?? "list"))).rejects.toThrow("Not allowed");
    }
  });
});
