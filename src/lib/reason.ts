import { cookies } from "next/headers";

// Why a step failed, in InboxCA's own words, for the page it goes back to with ?form=check
// and the like. It rides in a one minute cookie, never in the address, so a link cannot put
// words of its own on a page. Only a plain sentence InboxCA threw is kept; anything else (a
// library's or the database's message) leaves the page's general line.
export async function keepReason(error: unknown) {
  const text = error instanceof Error && error.name === "Error" && /^[A-Z][^\n]{2,300}[.?]$/.test(error.message) ? error.message : "";
  (await cookies()).set("reason", text, { maxAge: text ? 60 : 0, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/app" });
}

export const keptReason = async () => (await cookies()).get("reason")?.value || undefined;
