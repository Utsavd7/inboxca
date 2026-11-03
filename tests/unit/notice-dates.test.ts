import { expect, it } from "vitest";
import { readExtension } from "@/src/lib/notice-dates";

// Invented titles in the style official listings use; none is a real notice. A wrong date
// harms a firm, so only a plain extension reads as one, and nothing else moves a date.
it("reads a plain extension: the return, its period and the new date, and nothing invented", () => {
  expect(readExtension("99/2026-Central Tax: Seeks to extend the due date for furnishing FORM GSTR-3B for the month of September, 2026 till 25th October, 2026"))
    .toEqual({ codes: ["GSTR3B_M"], period: "2026-09", on: "2026-10-25" });
  expect(readExtension("Seeks to extend the due date of filing FORM GSTR-1 for the quarter July to September, 2026 upto 20.10.2026"))
    .toEqual({ codes: ["GSTR1_Q"], period: "2026-09", on: "2026-10-20" });
  expect(readExtension("CBDT extends the due date for furnishing return of income for AY 2026-27 for taxpayers not liable to audit from 31st July 2026 to 15th September 2026"))
    .toEqual({ codes: ["ITR_NA", "ITR_BIZ"], period: "2026-03", on: "2026-09-15", from: "2026-07-31" });
  expect(readExtension("Extension of the due date for furnishing the audit report under section 44AB for the tax year 2026-27 to 31st October 2027"))
    .toEqual({ codes: ["TAX_AUDIT"], period: "2027-03", on: "2027-10-31" });
  expect(readExtension("Seeks to extend the time limit for furnishing FORM GSTR-9 and GSTR-9C for FY 2025-26 till 31.01.2027"))
    .toEqual({ codes: ["GSTR9"], period: "2026-03", on: "2027-01-31" });
});

it("leaves anything less than plain to a person, with the reason", () => {
  const unclear = (title: string) => (readExtension(title) as { unclear?: string } | null)?.unclear;
  expect(unclear("Seeks to extend the due date for furnishing FORM GSTR-3B for the month of September, 2026 for registered persons whose principal place of business is in the State of Manipur")).toMatch(/state/);
  expect(unclear("Seeks to extend the due date for furnishing FORM GSTR-3B for the month of September, 2026")).toMatch(/new date/);
  expect(unclear("Seeks to extend the due date for furnishing FORM ITC-04 for the quarter ending September, 2026 till 30.11.2026")).toMatch(/does not keep/);
  expect(unclear("CBDT extends the due date for furnishing returns of income for AY 2026-27 to 10th December 2026")).toMatch(/which taxpayers/);
  expect(unclear("Seeks to extend the due date for furnishing FORM GSTR-3B till 25th October, 2026")).toMatch(/period/);
  expect(unclear("Seeks to extend the due date for furnishing FORM GSTR-1 for September, 2026 to 15th October 2026 and FORM GSTR-3B to 25th October 2026")).toMatch(/more than one/);
  expect(unclear("Seeks to extend the due date for furnishing FORM GSTR-3B for the month of September, 2026 till 31st September, 2026")).toMatch(/could not be read/);
  // Not about a due date at all.
  expect(readExtension("Seeks to notify a special procedure under Section 148 for payment of tax")).toBeNull();
  expect(readExtension("Advisory on the extended validity of e-way bills")).toBeNull();
});
