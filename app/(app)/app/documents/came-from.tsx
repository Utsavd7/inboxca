import Link from "next/link";
import type { Origin } from "@/src/lib/paper-origin";

// Where a paper came from and when, with the email it came in for those who may open it, where
// it was before old files were sorted, and why it waits under To check (src/lib/paper-origin.ts).
export function CameFrom({ origin, why = true }: { origin: Origin; why?: boolean }) {
  return (
    <span className="came-from">
      <span>
        {origin.how}, {origin.at}
      </span>
      {origin.from && (
        <span>
          It used to be at <span className="num">{origin.from}</span>
        </span>
      )}
      {origin.mail && (
        <Link className="came-from-mail" href={`/app/inbox?mail=${origin.mail}`}>
          Open the email
        </Link>
      )}
      {why && origin.why && <span className="came-from-why">Waiting to be checked: {origin.why}.</span>}
    </span>
  );
}
