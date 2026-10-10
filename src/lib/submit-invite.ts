import { z } from "zod";
import { contactEmail } from "./site";
import { clientRanges } from "@/content/site";
export const inviteSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(100, "Keep your name under 100 characters."),
  firm: z.string().trim().min(2, "Enter your firm name.").max(150, "Keep your firm name under 150 characters."),
  city: z.string().trim().min(2, "Enter your city.").max(100, "Keep your city under 100 characters."),
  email: z.email("Enter a valid email address.").max(254),
  clients: z.enum(clientRanges, { error: "Choose a rough client range." }),
});
export type Invite = z.infer<typeof inviteSchema>;
export function inviteMailto(input: Invite) {
  const values = inviteSchema.parse(input);
  const body = `Hello Orelu,\n\nI would like to ask for an InboxCA invite.\n\nName: ${values.name}\nFirm name: ${values.firm}\nCity: ${values.city}\nEmail: ${values.email}\nNumber of clients: ${values.clients}`;
  return `mailto:${contactEmail}?subject=${encodeURIComponent("Ask for an InboxCA invite")}&body=${encodeURIComponent(body)}`;
}
export function submitInvite(input: Invite) {
  // Connect the real invite endpoint here later. Until then this opens a draft only.
  // Never claim delivery: the visitor must send the email in their own app.
  window.location.href = inviteMailto(input);
}
