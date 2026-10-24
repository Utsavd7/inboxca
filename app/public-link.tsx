import { firmAddress } from "@/src/lib/firm-mail";

// What a client's private link shows when it is wrong or no longer known: nothing of the
// firm or the link, only what to do next.
export function LinkEnded() {
  return (
    <>
      <h1>This link has ended or was copied wrong.</h1>
      <p className="hint">Ask your CA&apos;s office to send a new one.</p>
    </>
  );
}

// The foot of a client's private link: the firm and how to reach it.
export async function FirmFoot({ firmId, name }: { firmId: string; name: string }) {
  const email = await firmAddress(firmId);
  return (
    <footer className="public-foot">
      <strong>{name}</strong>
      {email && (
        <span>
          Questions? Email <a href={`mailto:${email}`}>{email}</a>
        </span>
      )}
    </footer>
  );
}
