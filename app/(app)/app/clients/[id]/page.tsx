import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { clientKinds, type ClientKind } from "@/src/lib/clients";
import { serverCrypto } from "@/src/lib/crypto";
import { currentMember } from "@/src/lib/member";

const numberNames: Record<string, string> = { pan: "PAN", gstin: "GSTIN", tan: "TAN", cin: "CIN", llpin: "LLPIN" };

// One client. Its numbers are opened with the firm's key on the server, for this page only.
export default async function Client({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const { id } = await params;
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, kind, client_registrations(kind, number_enc, state_code)")
    .eq("id", id)
    .maybeSingle();
  if (!client) notFound();
  const crypto = serverCrypto();
  const numbers = await Promise.all(
    client.client_registrations.map(async (registration) => ({
      ...registration,
      number: await crypto.decrypt(membership.firmId, `clients/${client.id}/${registration.kind}`, registration.number_enc),
    })),
  );

  return (
    <>
      <p className="app-note">
        <Link href="/app/clients">Clients</Link>
      </p>
      <h1>
        {client.name}
        <span className="app-role">{clientKinds[client.kind as ClientKind]}</span>
      </h1>
      <section className="app-card" aria-labelledby="numbers">
        <h2 id="numbers">Registrations</h2>
        <ul className="app-list">
          {numbers.map((registration) => (
            <li key={registration.kind + registration.number}>
              <span className="person">{numberNames[registration.kind]}</span>
              <span className="num">{registration.number}</span>
            </li>
          ))}
        </ul>
        {!numbers.length && <p className="app-note">No PAN or GSTIN yet.</p>}
      </section>
    </>
  );
}
