import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";

// An office PC's own key (WebAuthn; PLAN.md 5.17, 5.17.4 #32, #50): made on the PC by its
// built in authenticator (Windows Hello and the like), kept there, and used to prove that a
// request really comes from that PC. Only its public half reaches the server. A key the
// authenticator may copy to other devices (a synced passkey) is refused: such a PC works as a
// laptop.
export const CHALLENGE_COOKIE = "inboxca_pc_challenge";
const SYNCED = 0x08;
const VERIFIED = 0x04;
type Response = { clientDataJSON: string; authenticatorData: string };

const mac = (value: string) =>
  createHmac("sha256", createHmac("sha256", process.env.SUPABASE_SECRET_KEY ?? "").update("pc key challenge").digest()).update(value).digest("base64url");

// A one-time question for this PC, good for 5 minutes, kept in a signed cookie.
export function newChallenge(deviceId: string) {
  const challenge = randomBytes(32).toString("base64url");
  const until = Date.now() + 5 * 60_000;
  return { challenge, cookie: `${challenge}.${until}.${mac(`${deviceId}:${challenge}:${until}`)}` };
}

// The parts every answer must get right: the question asked, this site, a person present.
function checked(type: string, response: Response, origin: string, cookie: string | undefined, deviceId: string) {
  const [challenge, until, signature = ""] = (cookie ?? "").split(".");
  const expected = mac(`${deviceId}:${challenge}:${until}`);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) || Number(until) < Date.now()) return null;
  const clientData = Buffer.from(response.clientDataJSON, "base64url");
  const authData = Buffer.from(response.authenticatorData, "base64url");
  let data: { type?: string; challenge?: string; origin?: string };
  try {
    data = JSON.parse(clientData.toString());
  } catch {
    return null;
  }
  const site = createHash("sha256").update(new URL(origin).hostname).digest();
  if (data.type !== type || data.challenge !== challenge || data.origin !== origin || authData.length < 37 || !authData.subarray(0, 32).equals(site) || !(authData[32] & 1)) return null;
  return { clientData, authData, synced: !!(authData[32] & SYNCED) };
}

export function checkNewKey(response: Response, origin: string, cookie: string | undefined, deviceId: string) {
  const result = checked("webauthn.create", response, origin, cookie, deviceId);
  return !result ? "invalid" : result.synced ? "synced" : "ok";
}

// Whether the key signed this answer.
function signed({ clientData, authData }: { clientData: Buffer; authData: Buffer }, publicKey: string, signature: string) {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, "base64url"), format: "der", type: "spki" });
    return verify("sha256", Buffer.concat([authData, createHash("sha256").update(clientData).digest()]), key, Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}

export function checkKeyUse(response: Response & { signature: string }, publicKey: string, origin: string, cookie: string | undefined, deviceId: string) {
  const result = checked("webauthn.get", response, origin, cookie, deviceId);
  return !!result && !result.synced && signed(result, publicKey, response.signature);
}

// An Orelu admin's passkey (PLAN.md 8.1, 8.10): the same checks, with the admin's PIN or
// fingerprint required every time. Unlike an office PC's key, a synced passkey is allowed: it
// proves the person, not a place, so a passkey kept on both a phone and a laptop is still theirs.
export function checkAdminKey(response: Response, origin: string, cookie: string | undefined, userId: string) {
  const result = checked("webauthn.create", response, origin, cookie, `admin:${userId}`);
  return !!result && !!(result.authData[32] & VERIFIED);
}

// The passkey's new signature counter when it signed this answer with the admin verified, else null.
export function checkAdminKeyUse(response: Response & { signature: string }, publicKey: string, origin: string, cookie: string | undefined, userId: string) {
  const result = checked("webauthn.get", response, origin, cookie, `admin:${userId}`);
  return result && result.authData[32] & VERIFIED && signed(result, publicKey, response.signature) ? result.authData.readUInt32BE(33) : null;
}
