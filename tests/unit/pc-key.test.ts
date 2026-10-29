import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { checkAdminKey, checkAdminKeyUse, checkKeyUse, checkNewKey, newChallenge, totp } from "@/src/lib/pc-key";

vi.stubEnv("APP_HMAC_KEY", randomBytes(32).toString("base64url"));

// An office PC's key answering InboxCA's question, as a browser would send it.
const origin = "https://inboxca.example";
const answer = (type: string, challenge: string, flags: number, counter = 0) => {
  const count = Buffer.alloc(4);
  count.writeUInt32BE(counter);
  const authenticatorData = Buffer.concat([createHash("sha256").update("inboxca.example").digest(), Buffer.of(flags), count]);
  const clientData = Buffer.from(JSON.stringify({ type, challenge, origin }));
  return { clientData, authenticatorData, response: { clientDataJSON: clientData.toString("base64url"), authenticatorData: authenticatorData.toString("base64url") } };
};

describe("an office PC's own key", () => {
  // #32, #36, #50: copied or synced keys cannot confirm a changed office line.
  it("accepts a key kept on the PC, refuses one that syncs to other devices, and checks every use", () => {
    const { challenge, cookie } = newChallenge("pc-1");
    expect(checkNewKey(answer("webauthn.create", challenge, 0x05).response, origin, cookie, "pc-1")).toBe("ok");
    expect(checkNewKey(answer("webauthn.create", challenge, 0x0d).response, origin, cookie, "pc-1")).toBe("synced");
    expect(checkNewKey(answer("webauthn.create", challenge, 0x05).response, origin, cookie, "pc-2")).toBe("invalid");
    expect(checkNewKey(answer("webauthn.create", "another", 0x05).response, origin, cookie, "pc-1")).toBe("invalid");

    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
    const use = answer("webauthn.get", challenge, 0x05);
    const signature = sign("sha256", Buffer.concat([use.authenticatorData, createHash("sha256").update(use.clientData).digest()]), privateKey).toString("base64url");
    expect(checkKeyUse({ ...use.response, signature }, spki, origin, cookie, "pc-1")).toBe(true);
    expect(checkKeyUse({ ...use.response, signature }, spki, "https://elsewhere.example", cookie, "pc-1")).toBe(false);
    const other = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "der", type: "spki" }).toString("base64url");
    expect(checkKeyUse({ ...use.response, signature }, other, origin, cookie, "pc-1")).toBe(false);
  });
});

describe("an Orelu admin's passkey", () => {
  const signed = (use: ReturnType<typeof answer>, privateKey: KeyObject) =>
    ({ ...use.response, signature: sign("sha256", Buffer.concat([use.authenticatorData, createHash("sha256").update(use.clientData).digest()]), privateKey).toString("base64url") });

  // PLAN.md 8.1: a passkey with the admin verified (PIN or fingerprint), synced or not.
  it("needs the admin verified, allows a synced passkey, and returns the signature counter", () => {
    const { challenge, cookie } = newChallenge("admin:a-1");
    expect(checkAdminKey(answer("webauthn.create", challenge, 0x05).response, origin, cookie, "a-1")).toBe(true);
    expect(checkAdminKey(answer("webauthn.create", challenge, 0x0d).response, origin, cookie, "a-1")).toBe(true);
    expect(checkAdminKey(answer("webauthn.create", challenge, 0x01).response, origin, cookie, "a-1")).toBe(false);
    expect(checkAdminKey(answer("webauthn.create", challenge, 0x05).response, origin, cookie, "a-2")).toBe(false);
    expect(checkAdminKey(answer("webauthn.create", challenge, 0x05).response, origin, newChallenge("pc-1").cookie, "a-1")).toBe(false);

    for (const { privateKey, publicKey } of [generateKeyPairSync("ec", { namedCurve: "P-256" }), generateKeyPairSync("rsa", { modulusLength: 2048 })]) {
      const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
      expect(checkAdminKeyUse(signed(answer("webauthn.get", challenge, 0x1d, 7), privateKey), spki, origin, cookie, "a-1")).toBe(7);
      expect(checkAdminKeyUse(signed(answer("webauthn.get", challenge, 0x01, 7), privateKey), spki, origin, cookie, "a-1")).toBeNull();
      expect(checkAdminKeyUse(signed(answer("webauthn.create", challenge, 0x05), privateKey), spki, origin, cookie, "a-1")).toBeNull();
      expect(checkAdminKeyUse(signed(answer("webauthn.get", challenge, 0x05), privateKey), spki, origin, cookie, "a-2")).toBeNull();
      const tampered = signed(answer("webauthn.get", challenge, 0x05, 1), privateKey);
      expect(checkAdminKeyUse({ ...tampered, authenticatorData: answer("webauthn.get", challenge, 0x05, 9).response.authenticatorData }, spki, origin, cookie, "a-1")).toBeNull();
    }
  });
});

describe("a firm person's passkey", () => {
  // PLAN.md 5.17: the admin's checks, for its own question, so neither answers for the other.
  it("answers only the question asked for a firm person, not an admin's", () => {
    const person = newChallenge("passkey:p-1");
    expect(checkAdminKey(answer("webauthn.create", person.challenge, 0x05).response, origin, person.cookie, "p-1", "passkey")).toBe(true);
    expect(checkAdminKey(answer("webauthn.create", person.challenge, 0x05).response, origin, person.cookie, "p-1")).toBe(false);
    const admin = newChallenge("admin:p-1");
    expect(checkAdminKey(answer("webauthn.create", admin.challenge, 0x05).response, origin, admin.cookie, "p-1", "passkey")).toBe(false);
  });

  // RFC 6238's SHA-1 test key (its codes 94287082 and 07081804; an app shows the last 6 digits).
  it("makes the authenticator app's code for the passkey's own factor", () => {
    // RFC 6238 appendix B: the SHA-1 key is the ASCII text 12345678901234567890, here in base32.
    const key = [...Buffer.from("12345678901234567890")].map((byte) => byte.toString(2).padStart(8, "0")).join("").match(/.{5}/g)!.map((bits) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[parseInt(bits, 2)]).join("");
    expect(totp(key, 59_000)).toBe("287082");
    expect(totp(key, 1_111_111_109_000)).toBe("081804");
  });
});
