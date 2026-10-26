import { firmDownload } from "@/src/lib/firm-download";
import { currentMember } from "@/src/lib/member";
import { todayInIndia } from "@/src/lib/calendar";
import { plainPage } from "@/src/lib/plain-page";

// The owner's download of the firm's data, as one ZIP. The database refuses anyone else and
// logs each download.
export async function POST(request: Request) {
  const origin = new URL(process.env.APP_BASE_URL ?? request.url).origin;
  if (request.headers.get("origin") !== origin) return plainPage(403, "This download could not start. Go back to Settings and try again.", "/app/settings?group=data", "Go to Settings");
  const { supabase, membership } = await currentMember();
  if (membership?.role !== "owner") return plainPage(404, "Only the owner can download the firm's data.", "/app", "Go to Today");
  const { data, error } = await supabase.rpc("firm_export", { target_firm: membership.firmId });
  if (error || !data) return plainPage(503, "InboxCA could not make the download just now. Try again in a minute.", "/app/settings?group=data", "Go to Settings");
  const bytes = await firmDownload(membership.firmId, data as Parameters<typeof firmDownload>[1]);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="inboxca-data-${todayInIndia()}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
