import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkKeyUse, checkNewKey, newChallenge } from "@/src/lib/pc-key";

// An office PC's key answering InboxCA's question, as a browser would send it.
const origin = "https://inboxca.example";
const answer = (type: string, challenge: string, flags: number) => {
  const authenticatorData = Buffer.concat([createHash("sha256").update("inboxca.example").digest(), Buffer.of(flags), Buffer.alloc(4)]);
  const clientData = Buffer.from(JSON.stringify({ type, challenge, origin }));
  return { clientData, authenticatorData, response: { clientDataJSON: clientData.toString("base64url"), authenticatorData: authenticatorData.toString("base64url") } };
};

describe("an office PC's own key", () => {
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
