import { z } from "zod";
import { contactEmail } from "./site";
import { clientRanges } from "@/content/site";
export const inviteSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter your name.")
    .max(100, "Use a shorter name."),
  firm: z
    .string()
    .trim()
    .min(2, "Enter your firm name.")
    .max(150, "Use a shorter firm name."),
  city: z
    .string()
    .trim()
    .min(2, "Enter your city.")
    .max(100, "Use a shorter city name."),
  email: z.email("Enter a valid email address.").max(254, "Use a shorter email address."),
  clients: z.enum(clientRanges, { error: "Choose a rough client range." }),
});
export type Invite = z.infer<typeof inviteSchema>;
export function inviteMailto(input: Invite) {
  const values = inviteSchema.parse(input);
  const body = `Hello Orelu,\n\nI would like to ask for an InboxCA invite.\n\nName: ${values.name}\nFirm name: ${values.firm}\nCity: ${values.city}\nEmail: ${values.email}\nNumber of clients: ${values.clients}`;
  return `mailto:${contactEmail}?subject=${encodeURIComponent("Ask for an InboxCA invite")}&body=${encodeURIComponent(body)}`;
}
// Posts the request to the invite endpoint. True only when the server says it was saved.
// Sent as plain text so that a simple receiver (a Google Apps Script, a small worker)
// needs no extra permission step in the browser.
export async function sendInvite(
  endpoint: string,
  input: Invite,
  send: typeof fetch = fetch,
) {
  const values = inviteSchema.parse(input);
  try {
    const response = await send(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ ...values, sentAt: new Date().toISOString() }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// With no endpoint set, this opens a draft in the visitor's own email app.
// Never claim delivery here: the visitor must send the email themselves.
export function submitInvite(input: Invite) {
  window.location.href = inviteMailto(input);
}
