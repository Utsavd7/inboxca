// Paid AI stays off until an AI key is added to the server (PLAN.md D29, M9): with no key
// nothing is called and nothing is billed, and the buttons that need it say so.
export const aiReady = () => !!process.env.OPENAI_API_KEY;

export type AiReason = "reply_draft" | "email_draft" | "auto_draft" | "reminder";

// The one place the app calls the AI provider. Every call names its reason, so M9's
// guardrails (credits, limits, output checks) wrap this function alone. The provider keeps
// nothing (store off). What comes back is only a suggestion a person reviews; AI never sends.
export async function askAi(reason: AiReason, instructions: string, input: string) {
  if (!aiReady()) return null;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.AI_AGENT_MODEL || "gpt-5-mini", instructions, input, store: false, metadata: { reason } }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!response?.ok) return null;
  const data = (await response.json().catch(() => null)) as { output?: { content?: { type: string; text?: string }[] }[] } | null;
  return data?.output?.flatMap((item) => item.content ?? []).find((part) => part.type === "output_text")?.text ?? null;
}
