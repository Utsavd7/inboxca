import { expect, it } from "vitest";
import { checkClient, cleanPhone, readKind, whatsappLink } from "@/src/lib/clients";

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
    client: { name: "Shah", kind: "business", pan: "AAPFU0939F", gstin: "27AAPFU0939F1ZV", email: "accounts@shah.in", phone: "" },
  });
  expect(checkClient({ name: "Shah", kind: "business", pan: "ABCPI1234K", gstin: "27AAPFU0939F1ZV", email: "" })).toEqual({
    error: "The PAN does not match the GSTIN. Characters 3 to 12 of a GSTIN are the PAN. Check both, or leave the PAN empty.",
  });
  expect(checkClient({ name: "Shah", kind: "business", pan: "", gstin: "", email: "shah@" })).toEqual({
    error: "That email address is not valid.",
  });
});

it("keeps a phone number as its country code and digits, for the WhatsApp link", () => {
  expect(cleanPhone("98765 43210")).toBe("+919876543210");
  expect(cleanPhone("098765-43210")).toBe("+919876543210");
  expect(cleanPhone("+44 20 7946 0958")).toBe("+442079460958");
  expect(cleanPhone("")).toBe("");
  for (const bad of ["12345", "98765 4321O", "+1"]) expect(cleanPhone(bad), bad).toBeNull();
  expect(checkClient({ name: "Shah", kind: "business", pan: "", gstin: "", email: "", phone: "12345" })).toHaveProperty("error");
  expect(whatsappLink("+919876543210", "Dear Shah,\nPlease upload: https://x.test/u/abc")).toBe("https://wa.me/919876543210?text=Dear%20Shah%2C%0APlease%20upload%3A%20https%3A%2F%2Fx.test%2Fu%2Fabc");
});
