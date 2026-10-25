"use client";
import { useState } from "react";
import { confirmWithPcKey, pcKeyChallenge, savePcKey } from "@/app/(app)/actions";

export const bytes = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
export const text = (buffer: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// An office PC's own key (PLAN.md 5.17.4 #32): set it up once, or use it to confirm a changed
// office connection. The PC asks for its PIN or fingerprint; the key never leaves it.
export function PcKey({ mode }: { mode: "setup" | "confirm" }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setMessage("");
    try {
      const start = await pcKeyChallenge();
      if (!start) return setMessage("This PC is not one that stays in the office.");
      const publicKey = { challenge: bytes(start.challenge), timeout: 60_000, userVerification: "preferred" as const };
      if (mode === "setup") {
        const credential = (await navigator.credentials.create({
          publicKey: {
            ...publicKey,
            rp: { name: "InboxCA" },
            user: { id: new TextEncoder().encode(start.deviceId), name: "Office PC", displayName: "Office PC" },
            pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
            authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "discouraged", userVerification: "preferred" },
            attestation: "none",
          },
        })) as PublicKeyCredential;
        const response = credential.response as AuthenticatorAttestationResponse;
        setMessage((await savePcKey({ id: credential.id, clientDataJSON: text(response.clientDataJSON), authenticatorData: text(response.getAuthenticatorData()), publicKey: text(response.getPublicKey()!) })) || "Done. This PC can now confirm a new office connection by itself.");
      } else {
        const credential = (await navigator.credentials.get({ publicKey: { ...publicKey, allowCredentials: [{ type: "public-key", id: bytes(start.keyId ?? "") }] } })) as PublicKeyCredential;
        const response = credential.response as AuthenticatorAssertionResponse;
        setMessage(await confirmWithPcKey({ id: credential.id, clientDataJSON: text(response.clientDataJSON), authenticatorData: text(response.authenticatorData), signature: text(response.signature) }));
      }
    } catch {
      setMessage("The PC did not finish. Try again, or ask the owner or a deputy.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="form-row">
      <button className="b b-primary b-small" type="button" onClick={run} disabled={busy}>
        {mode === "setup" ? "Set up this PC's key" : "Confirm with this PC's key"}
      </button>
      {message && <span className="hint" role="status">{message}</span>}
    </span>
  );
}
