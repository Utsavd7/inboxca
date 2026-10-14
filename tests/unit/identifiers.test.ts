import { expect, it } from "vitest";
import { cleanNumber, isGstin, isPan, numberKinds, panOfGstin } from "@/src/lib/identifiers";

it("accepts real PANs and GSTINs, refuses typing mistakes, and reads the PAN in a GSTIN", () => {
  expect(isPan(cleanNumber(" aapfu 0939f "))).toBe(true);
  expect(isPan("AAPFU09390")).toBe(false);
  expect(isGstin("27AAPFU0939F1ZV")).toBe(true);
  expect(isGstin("27AAPFU0939F1ZW")).toBe(false); // wrong check character
  expect(isGstin("27AAPFU0939G1ZV")).toBe(false); // one letter mistyped
  expect(panOfGstin("27AAPFU0939F1ZV")).toBe("AAPFU0939F");
});

it("knows the shape of a TAN, CIN and LLPIN", () => {
  expect(numberKinds.tan.valid("MUMA12345B")).toBe(true);
  expect(numberKinds.cin.valid("U74999MH2016PTC123456")).toBe(true);
  expect(numberKinds.llpin.valid("AAB-1234")).toBe(true);
  expect(numberKinds.tan.valid("MUM12345B")).toBe(false);
});
