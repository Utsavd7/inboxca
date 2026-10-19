import { describe, expect, it } from "vitest";
import { encrypt } from "@/src/lib/push";

describe("phone notifications", () => {
  // Every key below is the public example published in RFC 8291, section 5; none is a secret.
  it("seals a message exactly as the worked example in RFC 8291 does", () => {
    const body = encrypt(
      "When I grow up, I want to be a watermelon",
      { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" }, // ggignore: RFC 8291 example
      Buffer.from("DGv6ra1nlYgDCS1FRnbzlw", "base64url"), // ggignore: RFC 8291 example
      Buffer.from("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", "base64url"), // ggignore: RFC 8291 example
    );
    expect(body.toString("base64url")).toBe(
      // ggignore: RFC 8291 example
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });
});
