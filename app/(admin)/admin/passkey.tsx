"use client";
import { useState } from "react";
import { bytes, text } from "@/app/(app)/app/pc-key";
import { checkPasskey, passkeyChallenge, savePasskey } from "./actions";

// An Orelu admin's passkey (PLAN.md 8.1): set one up (on this laptop, a phone or a security
// key), or check one to open the console. The device asks for its PIN or fingerprint.
export function Passkey({ mode, button, note }: { mode: "setup" | "add" | "check"; button: string; note: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setMessage("");
    try {
      const start = await passkeyChallenge();
      const publicKey = { challenge: bytes(start.challenge), timeout: 60_000, userVerification: "required" as const };
      const keys = start.keys.map((id) => ({ type: "public-key" as const, id: bytes(id) }));
      if (mode === "check") {
        const credential = (await navigator.credentials.get({ publicKey: { ...publicKey, allowCredentials: keys } })) as PublicKeyCredential;
        const response = credential.response as AuthenticatorAssertionResponse;
        setMessage(await checkPasskey({ id: credential.id, clientDataJSON: text(response.clientDataJSON), authenticatorData: text(response.authenticatorData), signature: text(response.signature) }));
      } else {
        const credential = (await navigator.credentials.create({
          publicKey: {
            ...publicKey,
            rp: { name: "Orelu admin" },
            user: { id: new TextEncoder().encode(start.userId), name: start.email, displayName: start.email },
            pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
            excludeCredentials: keys,
            authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
            attestation: "none",
          },
        })) as PublicKeyCredential;
        const response = credential.response as AuthenticatorAttestationResponse;
        setMessage((await savePasskey({ id: credential.id, clientDataJSON: text(response.clientDataJSON), authenticatorData: text(response.getAuthenticatorData()), publicKey: text(response.getPublicKey()!) })) || "Passkey added.");
      }
    } catch {
      setMessage("The passkey did not finish. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className={button} type="button" onClick={run} disabled={busy}>
        {busy ? "Waiting for your passkey" : mode === "check" ? "Use my passkey" : mode === "setup" ? "Set up a passkey" : "Add a passkey"}
      </button>
      {message && <p className={note} role="status">{message}</p>}
    </>
  );
}
