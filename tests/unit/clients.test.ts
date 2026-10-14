import { expect, it } from "vitest";
import { checkClient, readKind } from "@/src/lib/clients";

it("reads kinds the way people write them, and guesses blanks from the GSTIN", () => {
  expect(readKind("Pvt Ltd", false)).toBe("company");
  expect(readKind("Proprietor", true)).toBe("business");
  expect(readKind("LLP", false)).toBe("llp");
  expect(readKind("Business with tax audit", false)).toBe("tax_audit");
  expect(readKind("", true)).toBe("business");
  expect(readKind("", false)).toBe("individual");
  expect(readKind("Martian", false)).toBeNull();
});

it("cleans a client, takes the PAN from its GSTIN, and checks the email", () => {
  expect(checkClient({ name: " Shah ", kind: "business", pan: "", gstin: "27aapfu0939f1zv", email: " Accounts@Shah.in " })).toEqual({
    client: { name: "Shah", kind: "business", pan: "AAPFU0939F", gstin: "27AAPFU0939F1ZV", email: "accounts@shah.in" },
  });
  expect(checkClient({ name: "Shah", kind: "business", pan: "ABCPI1234K", gstin: "27AAPFU0939F1ZV", email: "" })).toEqual({
    error: "The PAN does not match the one inside the GSTIN.",
  });
  expect(checkClient({ name: "Shah", kind: "business", pan: "", gstin: "", email: "shah@" })).toEqual({
    error: "That email address is not valid.",
  });
});
