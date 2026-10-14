import { expect, it } from "vitest";
import { cleanNumber, isGstin, isPan, panOfGstin } from "@/src/lib/identifiers";

it("accepts real PANs and GSTINs, refuses typing mistakes, and reads the PAN in a GSTIN", () => {
  expect(isPan(cleanNumber(" aapfu 0939f "))).toBe(true);
  expect(isPan("AAPFU09390")).toBe(false);
  expect(isGstin("27AAPFU0939F1ZV")).toBe(true);
  expect(isGstin("27AAPFU0939F1ZW")).toBe(false); // wrong check character
  expect(isGstin("27AAPFU0939G1ZV")).toBe(false); // one letter mistyped
  expect(panOfGstin("27AAPFU0939F1ZV")).toBe("AAPFU0939F");
});
