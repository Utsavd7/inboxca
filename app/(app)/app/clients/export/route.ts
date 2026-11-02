import { columns, safeCell, sheet, sheetType, workbook } from "@/src/lib/client-sheet";
import { canManageClients, clientKinds, serviceChoice, type ClientKind } from "@/src/lib/clients";
import { serverCrypto } from "@/src/lib/crypto";
import { currentMember } from "@/src/lib/member";
import { supabaseAdmin } from "@/src/lib/supabase";

// Clients > Export to Excel: the firm's current clients under the template's own headings, so
// the file imports back as it is. For the owner, partners and managers, who see every client;
// each number, email and phone is opened here on the server with the firm's key, and the
// export is logged. A cell a spreadsheet could run as a formula is written as text (safeCell).
export const dynamic = "force-dynamic";
const lookAfter = ["partner_in_charge", "manager", "staff"];

export async function GET() {
  const { supabase, userId, membership } = await currentMember();
  if (!membership || !canManageClients(membership.role)) return new Response("Not allowed", { status: 403 });
  const firm = membership.firmId;
  const crypto = serverCrypto();
  const { data: people } = await supabase.rpc("firm_people", { target_firm: firm });
  const emailOf = new Map(people?.map((person) => [person.user_id, person.email]));
  const rows: string[][] = [];
  // A page of clients at a time, as the database serves at most 1,000 rows a read.
  for (let from = 0; ; from += 1000) {
    const { data: clients } = await supabase
      .from("clients")
      .select("id, name, kind, email_enc, phone_enc, tags, client_registrations(kind, number_enc, services), client_assignments(user_id, role)")
      .eq("firm_id", firm)
      .is("archived_at", null)
      .order("name")
      .order("id")
      .range(from, from + 999);
    for (const client of clients ?? []) {
      const number = async (kind: string) => {
        const registration = client.client_registrations.find((row) => row.kind === kind);
        return registration ? crypto.decrypt(firm, `clients/${client.id}/${kind}`, registration.number_enc) : "";
      };
      const servicesOn = (kind: string) => client.client_registrations.find((row) => row.kind === kind)?.services ?? [];
      const lead = client.client_assignments.filter((row) => row.user_id).sort((a, b) => lookAfter.indexOf(a.role) - lookAfter.indexOf(b.role))[0];
      rows.push([
        client.name,
        clientKinds[client.kind as ClientKind] ?? client.kind,
        await number("pan"),
        await number("gstin"),
        client.email_enc ? await crypto.decrypt(firm, `clients/${client.id}/email`, client.email_enc) : "",
        await number("tan"),
        serviceChoice("GST returns", servicesOn("gstin")),
        serviceChoice("TDS returns", servicesOn("tan")),
        serviceChoice("Income tax return", servicesOn("pan")),
        client.phone_enc ? await crypto.decrypt(firm, `clients/${client.id}/phone`, client.phone_enc) : "",
        emailOf.get(lead?.user_id ?? "") ?? "",
        client.tags.join(", "),
      ].map(safeCell));
    }
    if ((clients?.length ?? 0) < 1000) break;
  }
  await supabaseAdmin().from("activity_log").insert({ firm_id: firm, actor_id: userId, action: "clients.exported", entity_type: "firm", entity_id: firm, details: { clients: rows.length } });
  const bytes = workbook([{ name: "Clients", xml: sheet([columns, ...rows], (row) => (row ? 0 : 1)) }]);
  return new Response(bytes, {
    headers: {
      "Content-Type": `${sheetType}.sheet`,
      "Content-Disposition": `attachment; filename="InboxCA clients ${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
