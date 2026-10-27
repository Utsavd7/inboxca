"use client";
import { useState } from "react";
import { bytes, text } from "@/app/(app)/app/pc-key";
import { addPasskey } from "@/app/(app)/actions";
import { checkPersonPasskey, personPasskeyChallenge } from "@/app/(auth)/actions";
import { checkPasskey, passkeyChallenge, savePasskey } from "./actions";

type Start = { challenge: string; userId: string; email: string; keys: string[] } | { error: string };
type Answer = { id: string; clientDataJSON: string; authenticatorData: string };
type Kind = { rp: string; challenge(name?: string): Promise<Start>; save(key: Answer & { publicKey: string; name?: string }): Promise<string>; check(key: Answer & { signature: string }): Promise<string> };
const kinds: Record<"admin" | "person", Kind> = {
  admin: { rp: "Orelu admin", challenge: passkeyChallenge, save: savePasskey, check: checkPasskey },
  person: { rp: "InboxCA", challenge: personPasskeyChallenge, save: addPasskey, check: checkPersonPasskey },
};

// An Orelu admin's passkey (PLAN.md 8.1): set one up (on this laptop, a phone or a security
// key), or check one to open the console. The device asks for its PIN or fingerprint. A firm
// person's passkey (5.17) works the same way, named when added, in place of the 6 digit code.
export function Passkey({ mode, button, note, kind = "admin" }: { mode: "setup" | "add" | "check"; button: string; note: string; kind?: keyof typeof kinds }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const named = kind === "person" && mode !== "check";
  const run = async () => {
    setBusy(true);
    setMessage("");
    try {
      const actions = kinds[kind];
      const start = await actions.challenge(named ? name : undefined);
      if ("error" in start) return setMessage(start.error);
      const publicKey = { challenge: bytes(start.challenge), timeout: 60_000, userVerification: "required" as const };
      const keys = start.keys.map((id) => ({ type: "public-key" as const, id: bytes(id) }));
      if (mode === "check") {
        const credential = (await navigator.credentials.get({ publicKey: { ...publicKey, allowCredentials: keys } })) as PublicKeyCredential;
        const response = credential.response as AuthenticatorAssertionResponse;
        setMessage(await actions.check({ id: credential.id, clientDataJSON: text(response.clientDataJSON), authenticatorData: text(response.authenticatorData), signature: text(response.signature) }));
      } else {
        const credential = (await navigator.credentials.create({
          publicKey: {
            ...publicKey,
            rp: { name: actions.rp },
            user: { id: new TextEncoder().encode(start.userId), name: start.email, displayName: start.email },
            pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
            excludeCredentials: keys,
            authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
            attestation: "none",
          },
        })) as PublicKeyCredential;
        const response = credential.response as AuthenticatorAttestationResponse;
        const refused = await actions.save({ id: credential.id, clientDataJSON: text(response.clientDataJSON), authenticatorData: text(response.getAuthenticatorData()), publicKey: text(response.getPublicKey()!), name });
        setMessage(refused || "Passkey added.");
        if (!refused) setName("");
      }
    } catch {
      setMessage("The passkey did not finish. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {named && (
        <div>
          <label htmlFor="passkey-name">Name this passkey, such as Office laptop</label>
          <input id="passkey-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={40} autoComplete="off" />
        </div>
      )}
      <button className={button} type="button" onClick={run} disabled={busy}>
        {busy ? "Waiting for your passkey" : mode === "check" ? "Use my passkey" : mode === "setup" ? "Set up a passkey" : "Add a passkey"}
      </button>
      {message && <p className={note} role="status">{message}</p>}
    </>
  );
}
