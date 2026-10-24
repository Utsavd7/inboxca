import { firmDownload } from "@/src/lib/firm-download";
import { currentMember } from "@/src/lib/member";
import { todayInIndia } from "@/src/lib/calendar";

// The owner's download of the firm's data, as one ZIP. The database refuses anyone else and
// logs each download.
export async function POST(request: Request) {
  const origin = new URL(process.env.APP_BASE_URL ?? request.url).origin;
  if (request.headers.get("origin") !== origin) return new Response("Not allowed", { status: 403 });
  const { supabase, membership } = await currentMember();
  if (membership?.role !== "owner") return new Response("Not found", { status: 404 });
  const { data, error } = await supabase.rpc("firm_export", { target_firm: membership.firmId });
  if (error || !data) return new Response("Not found", { status: 404 });
  const bytes = await firmDownload(membership.firmId, data as Parameters<typeof firmDownload>[1]);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="inboxca-data-${todayInIndia()}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
