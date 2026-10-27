import { createHmac, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { cashfree } from "@/src/lib/billing/cashfree";
import { docHtml, docNotes, docRows, taxLines, type Doc } from "@/src/lib/billing/documents";
import {
  addMonths, chosenPlan, financialYear, formulaSchema, GB, gstOn, gstSplit, mandateMax, methodsFor, moneyBackLastDay, overdueState, planFit, planPrice, prorate, serialNumber, taxSchema, toYearly, withGst,
} from "@/src/lib/billing/money";
import { custom, extraPerson, plans, practices } from "@/content/plans";

// Orelu's billing rules (PLAN.md 5.14, 5.14.1, D32): amounts from the formula, GST from the
// start date, the AutoPay method by amount, serial numbers, proration and the Cashfree webhook.
// The formula here is the site's price list, as the database's plan_formula holds it.
const formula = formulaSchema.parse({
  version: 1,
  plans: plans.map((plan, at) => ({ code: plan.name.toLowerCase(), name: plan.name, monthly: plan.monthly, yearly: plan.yearly, maxReturns: plan.maxReturns, people: plan.people, aiCredits: Number(plan.ai.replace(",", "")), blockCap: [1, 3, 8, 3][at] })),
  practices, extraPerson,
  custom: { ...custom, workSlabs: custom.workSlabs.map(([upTo, rate]) => [Number.isFinite(upTo) ? upTo : null, rate]), peopleSlabs: custom.peopleSlabs.map(([upTo, rate]) => [Number.isFinite(upTo) ? upTo : null, rate]), blockShare: 0.25 },
  aiBlock: { credits: 4000, price: 399 }, growthCushion: 0.1, fitEnforced: false,
});
const tax = taxSchema.parse({ legalName: "Invented Orelu Partners", address: "1 Invented Road, Pune", pan: "AAAFI1234B", gstin: "27AAAFI1234B1Z5", stateCode: "27", sac: "9983", rate: 18, gstFrom: "2027-04-01" });

describe("plan prices from the formula", () => {
  it("names the plan the answers fit and prices it in paise, line by line", () => {
    expect(planPrice(formula, { clients: 60, practice: "mixed", people: 1, aiBlocks: 0 }, "monthly")).toMatchObject({ code: "solo", paise: 149_900 });
    expect(planPrice(formula, { clients: 60, practice: "mixed", people: 1, aiBlocks: 0 }, "yearly").paise).toBe(1_649_900);
    // Four more people on Solo, a month and at the yearly multiple of 11 months.
    const team = planPrice(formula, { clients: 50, practice: "mixed", people: 5, aiBlocks: 0 }, "monthly");
    expect(team.lines.map((line) => line.paise)).toEqual([149_900, 159_600]);
    expect(planPrice(formula, { clients: 50, practice: "mixed", people: 5, aiBlocks: 0 }, "yearly").paise).toBe(1_649_900 + 159_600 * 11);
    expect(planPrice(formula, { clients: 150, practice: "mixed", people: 4, aiBlocks: 2 }, "monthly")).toMatchObject({ code: "growth", paise: 349_900 + 79_800, blockCap: 3 });
    expect(planPrice(formula, { clients: 900, practice: "mixed", people: 8, aiBlocks: 0 }, "monthly")).toMatchObject({ code: "custom", paise: 1_949_900 });
  });

  it("prices a plan chosen on the site from the formula, never from the link, and drops a bad link", () => {
    expect(chosenPlan(formula, { plan: "growth", cycle: "yearly", clients: "120", practice: "mixed", people: "5", price: "1" }))
      .toMatchObject({ cycle: "yearly", plan: { clients: 120, practice: "mixed", people: 5 }, price: { code: "growth", paise: 3_849_900 } });
    // A plan other than the one the answers name: that plan's size in the same kind of practice.
    expect(chosenPlan(formula, { plan: "scale", clients: "120", practice: "salaried", people: "5" })).toMatchObject({ cycle: "monthly", plan: { clients: 2000 }, price: { code: "scale", paise: 749_900 } });
    expect(chosenPlan(formula, { plan: "solo", clients: "abc" })).toMatchObject({ plan: { clients: 70, practice: "mixed", people: 1 }, price: { code: "solo" } });
    for (const query of [{}, { plan: "gold", clients: "120", practice: "mixed", people: "5" }, { plan: "custom", clients: "120", practice: "mixed", people: "5" }, { plan: ["growth", "scale"] }])
      expect(chosenPlan(formula, query)).toBeNull();
  });
});

describe("the plan fit from the meters (5.14, D38)", () => {
  const solo = { clients: 60, practice: "mixed" as const, people: 1, aiBlocks: 0 };
  const none = { returns: 0, returnsByMarch: 0, bytes: 0, bytesByMarch: 0 };
  const fit = (used: Partial<typeof none>, cycle: "monthly" | "yearly" = "yearly", day = "2026-10-27", plan = solo) => planFit(formula, plan, cycle, { ...none, ...used }, day);

  it("gives a yearly payer the year's allowance at once, and a monthly payer a twelfth a month, carried forward to March", () => {
    expect(fit({}).measures.map((m) => m.earned)).toEqual([800, 4 * GB]);
    expect(fit({}, "monthly", "2026-04-01").measures[0].earned).toBeCloseTo(800 / 12);
    // October is the 7th month: what April to September left unused is still there.
    expect(fit({}, "monthly").measures[0].earned).toBeCloseTo((800 * 7) / 12);
    expect(fit({}, "monthly", "2027-03-31").measures[0].earned).toBe(800);
    expect(fit({ returns: 374, returnsByMarch: 374 }, "monthly")).toMatchObject({ notice: true, over: false });
    expect(fit({ returns: 374, returnsByMarch: 374 })).toMatchObject({ notice: false });
  });

  it("tells the owner at 80% of the plan, or when the projection passes it, whichever comes first", () => {
    expect(fit({ returns: 639, returnsByMarch: 800 }).notice).toBe(false);
    expect(fit({ returns: 640, returnsByMarch: 800 }).notice).toBe(true);
    expect(fit({ returns: 10, returnsByMarch: 801 }).notice).toBe(true);
    expect(fit({ bytes: 0.8 * 4 * GB, bytesByMarch: 0.8 * 4 * GB }).notice).toBe(true);
    expect(fit({ bytes: GB, bytesByMarch: 4 * GB + 1 }).notice).toBe(true);
  });

  it("moves a firm past its plan and the 10% cushion to the plan that fits, and above Enterprise to Custom priced by the formula", () => {
    expect(fit({ returns: 880, returnsByMarch: 880 }).over).toBe(false);
    const past = fit({ returns: 881, returnsByMarch: 1200 });
    expect(past.over).toBe(true);
    expect(planPrice(formula, past.next, "monthly")).toMatchObject({ code: "growth", paise: 349_900 });
    // A monthly payer whose year passes Solo: 600 returns by October are 1,029 at a full year's pace, still Growth.
    expect(planPrice(formula, fit({ returns: 600, returnsByMarch: 900 }, "monthly").next, "monthly").code).toBe("growth");
    // At 80% the plan offered is the next one up even when the year still fits.
    expect(planPrice(formula, fit({ returns: 700, returnsByMarch: 700 }).next, "monthly").code).toBe("growth");
    // 9,000 returns: 45 GB at 200 returns a GB, Enterprise's ₹15,499 + 5 × ₹305, rounded to end in 499.
    expect(planPrice(formula, fit({ returns: 9000, returnsByMarch: 9000 }).next, "monthly")).toMatchObject({ code: "custom", paise: 1_749_900 });
    // Storage decides when it is the bigger measure: 11 GB is past Growth's 10 GB.
    expect(planPrice(formula, fit({ bytes: 11 * GB, bytesByMarch: 11 * GB }).next, "monthly").code).toBe("scale");
  });

  it("offers a monthly payer past its share whose year still fits the plan yearly payment, not a bigger plan", () => {
    // 600 returns by October are past 7 twelfths of Solo's 800 and its cushion, but the year's 600 fit.
    expect(fit({ returns: 600, returnsByMarch: 600 }, "monthly")).toMatchObject({ notice: true, over: true, yearly: true });
    expect(fit({ returns: 600, returnsByMarch: 801 }, "monthly").yearly).toBe(false);
    expect(fit({ returns: 600, returnsByMarch: 600, bytesByMarch: 4 * GB + 1 }, "monthly").yearly).toBe(false);
    expect(fit({ returns: 700, returnsByMarch: 700 }).yearly).toBe(false);
  });
});

describe("GST (D32)", () => {
  it("is charged only from the start date and with every detail set", () => {
    expect(gstOn(tax, "2027-03-31")).toBe(false);
    expect(gstOn(tax, "2027-04-01")).toBe(true);
    expect(gstOn({ ...tax, sac: undefined }, "2027-04-01")).toBe(false);
    expect(gstOn(null, "2027-04-01")).toBe(false);
    expect(withGst(349_900, tax, "27", "2027-03-31")).toEqual({ taxable: 349_900, gst: 0, total: 349_900 });
    expect(withGst(349_900, tax, "27", "2027-04-01")).toEqual({ taxable: 349_900, gst: 62_982, total: 412_882 });
  });

  it("is CGST and SGST in Orelu's state, IGST in another", () => {
    expect(gstSplit(100_000, 18, true)).toEqual({ cgst: 9000, sgst: 9000, igst: 0, total: 18_000 });
    expect(gstSplit(100_000, 18, false)).toEqual({ cgst: 0, sgst: 0, igst: 18_000, total: 18_000 });
    expect(taxLines(62_983, true)).toEqual({ cgst: 31_492, sgst: 31_491, igst: 0 });
  });
});

describe("the AutoPay method by amount (RBI E-mandate Framework 2026, para 8(a))", () => {
  it("offers UPI AutoPay, card and eNACH up to ₹15,000, and eNACH first above it", () => {
    expect(methodsFor(1_500_000)).toEqual([{ method: "upi", approveEach: false }, { method: "card", approveEach: false }, { method: "enach", approveEach: false }]);
    expect(methodsFor(1_500_001)).toEqual([{ method: "enach", approveEach: false }, { method: "upi", approveEach: true }, { method: "card", approveEach: true }]);
    expect(methodsFor(10_000_001).map((choice) => choice.method)).toEqual(["enach", "card"]);
  });

  it("sets the mandate's maximum at twice the price, within the method's limit", () => {
    expect(mandateMax(1_549_900, "enach")).toBe(3_099_800);
    expect(mandateMax(17_049_900, "upi")).toBe(10_000_000);
  });
});

describe("dates, proration and the overdue states", () => {
  it("adds months to the same day, or the month's last", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-15", 12)).toBe("2027-11-15");
  });

  it("charges what is left of the paid period", () => {
    // Paid 15 Oct to 15 Nov (31 days); 14 days left on 1 Nov.
    expect(prorate(310_000, "2026-11-01", "2026-11-15", "monthly")).toBe(140_000);
    expect(prorate(310_000, "2026-11-15", "2026-11-15", "monthly")).toBe(0);
  });

  it("switches a monthly payer to yearly payment: the rest of the year at the yearly price, less what is left of the month paid", () => {
    const solo = { clients: 60, practice: "mixed" as const, people: 1, aiBlocks: 0 };
    // Paid 15 Oct to 14 Nov 2027: 157 of the year's 366 days at ₹16,499, less 19 of the month's 31 days at ₹1,499.
    const year = toYearly(formula, solo, "2027-10-27", "2027-11-15");
    expect(year).toEqual({ until: "2028-04-01", paise: 707_744 - 91_874 });
    expect(withGst(year.paise, tax, "27", "2027-10-27")).toEqual({ taxable: 615_870, gst: 110_856, total: 726_726 });
    // In March, with the month paid running into April, the whole next year is paid too.
    expect(toYearly(formula, solo, "2027-03-20", "2027-04-05")).toEqual({ until: "2028-04-01", paise: 1_649_900 + 54_243 - 77_368 });
  });

  it("keeps a firm working for 7 days, then view only to day 30, then closing", () => {
    expect(overdueState("2026-11-15", "2026-11-14")).toBe("active");
    expect(overdueState("2026-11-15", "2026-11-22")).toBe("grace");
    expect(overdueState("2026-11-15", "2026-11-23")).toBe("read_only");
    expect(overdueState("2026-11-15", "2026-12-15")).toBe("read_only");
    expect(overdueState("2026-11-15", "2026-12-16")).toBe("closed");
  });

  it("ends the money-back window 14 days after the first payment", () => {
    expect(moneyBackLastDay("2026-10-01")).toBe("2026-10-15");
  });
});

describe("serial numbers (CGST rules 46(b), 53(1A)(c))", () => {
  it("are at most 16 characters, by kind and financial year", () => {
    expect(serialNumber("receipt", "2026-10-27", 1)).toBe("RCT/26-27/00001");
    expect(serialNumber("credit", "2027-03-31", 42)).toBe("CN/26-27/00042");
    expect(serialNumber("invoice", "2027-04-01", 7)).toBe("INV/27-28/00007");
    expect(financialYear("2027-03-31")).toBe("2026-27");
    expect(() => serialNumber("receipt", "2026-10-27", 1_000_000)).toThrow();
  });
});

describe("documents", () => {
  const invoice: Doc = {
    kind: "invoice", no: "INV/27-28/00001", date: "2027-04-02",
    seller: { name: tax.legalName, address: tax.address, pan: tax.pan, gstin: tax.gstin, stateCode: "27", state: "Maharashtra" },
    buyer: { name: "Invented & Co <CA>", address: "2 Invented Lane", stateCode: "27", state: "Maharashtra" },
    lines: [{ text: "InboxCA Growth plan, monthly", paise: 349_900 }], taxable: 349_900, cgst: 31_491, sgst: 31_491, igst: 0, rate: 18, sac: "9983", total: 412_882, paidBy: "UPI AutoPay",
  };

  it("shows a tax invoice's SAC, taxable value, CGST and SGST and place of supply", () => {
    expect(docRows(invoice)).toEqual([["SAC (HSN for services)", "9983"], ["InboxCA Growth plan, monthly", "₹3,499"], ["Taxable value", "₹3,499"], ["CGST at 9%", "₹314.91"], ["SGST at 9%", "₹314.91"], ["Total paid", "₹4,128.82"]]);
    expect(docNotes(invoice)).toContain("Place of supply: Maharashtra (code 27). Tax payable on reverse charge: No.");
  });

  it("says plainly on a receipt that Orelu is not GST registered", () => {
    const receipt: Doc = { ...invoice, kind: "receipt", seller: { ...invoice.seller, gstin: undefined }, cgst: 0, sgst: 0, total: 349_900, rate: undefined, sac: undefined };
    expect(docRows(receipt)).toEqual([["InboxCA Growth plan, monthly", "₹3,499"], ["Total paid", "₹3,499"]]);
    expect(docNotes(receipt)).toContain("Orelu is not registered under GST, so no GST is charged.");
  });

  it("names the invoice a credit note corrects, and escapes the page", () => {
    const credit: Doc = { ...invoice, kind: "credit", no: "CN/27-28/00001", of: { no: invoice.no, date: invoice.date }, reason: "money_back", signatory: "Invented Signatory" };
    expect(docNotes(credit)).toEqual(expect.arrayContaining([`For ${invoice.no} of 2 April 2027.`, "Reason: Money back within 14 days of the first payment.", "For Invented Orelu Partners, authorised signatory: Invented Signatory."]));
    expect(docHtml(credit)).toContain("Invented &#38; Co &#60;CA&#62;");
    expect(docHtml(credit)).not.toContain("<script");
  });
});

describe("Cashfree webhooks", () => {
  const secret = randomBytes(24).toString("base64url");
  afterEach(() => void delete process.env.CASHFREE_SECRET_KEY);
  const signed = (body: object, key = "event-1") => {
    const raw = JSON.stringify(body);
    const timestamp = "1761550000000";
    return { raw, headers: new Headers({ "x-webhook-timestamp": timestamp, "x-webhook-signature": createHmac("sha256", secret).update(timestamp + raw).digest("base64"), "x-idempotency-key": key }) };
  };

  it("are verified with the client secret over the timestamp and raw body", () => {
    process.env.CASHFREE_SECRET_KEY = secret;
    const { raw, headers } = signed({ type: "PAYMENT_SUCCESS_WEBHOOK", data: {} });
    expect(cashfree().verify(raw, headers)).toBe(true);
    expect(cashfree().verify(raw.replace("{}", '{"x":1}'), headers)).toBe(false);
    headers.set("x-webhook-signature", "forged");
    expect(cashfree().verify(raw, headers)).toBe(false);
  });

  it("are read as mandate, payment and refund events with their own key", () => {
    const parse = (body: object) => { const { raw, headers } = signed(body); return cashfree().parse(raw, headers); };
    expect(parse({ type: "SUBSCRIPTION_STATUS_CHANGED", data: { subscription_details: { subscription_id: "ib-1", subscription_status: "ACTIVE" }, authorization_details: { payment_id: "auth-9", payment_group: "upi", payment_method: { upi: {} } } } }))
      .toEqual({ key: "event-1", type: "mandate", mandate: "ib-1", status: "active", method: "upi", ref: "auth-9" });
    expect(parse({ type: "SUBSCRIPTION_STATUS_CHANGED", data: { subscription_details: { subscription_id: "ib-1", subscription_status: "CUSTOMER_CANCELLED" } } })).toMatchObject({ type: "mandate", status: "cancelled" });
    expect(parse({ type: "SUBSCRIPTION_PAYMENT_FAILED", data: { payment_id: "p-1", cf_payment_id: 55, payment_type: "CHARGE", failure_details: { failure_reason: "Insufficient funds" } } }))
      .toEqual({ key: "event-1", type: "payment", payment: "p-1", status: "failed", ref: "55", reason: "Insufficient funds" });
    expect(parse({ type: "SUBSCRIPTION_PAYMENT_SUCCESS", data: { payment_id: "auth-9", payment_type: "AUTH" } })).toBeNull();
    expect(parse({ type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: "o-1" }, payment: { cf_payment_id: 77, payment_status: "SUCCESS" } } })).toMatchObject({ type: "payment", payment: "o-1", status: "done", ref: "77" });
    expect(parse({ type: "REFUND_STATUS_WEBHOOK", data: { refund: { refund_id: "r-1", cf_refund_id: 8, refund_status: "SUCCESS" } } })).toMatchObject({ type: "refund", refund: "r-1", status: "done" });
    expect(parse({ type: "SUBSCRIPTION_REFUND_STATUS", data: { refund_id: "r-2", refund_status: "FAILED" } })).toMatchObject({ type: "refund", refund: "r-2", status: "failed" });
    expect(parse({ type: "SUBSCRIPTION_REFUND_STATUS", data: { refund_id: "r-2", refund_status: "PENDING" } })).toBeNull();
  });
});
