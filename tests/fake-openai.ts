import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

// A stand in for OpenAI's Responses API (src/lib/ai.ts, OPENAI_TEST_URL with MAIL_ALLOW_LOCAL),
// on this machine only, so no test calls or pays for real AI. It answers only the key made for
// the run, keeps each request for the test to count, and replies with the text and token usage
// the test sets, or an error for none. `during` runs while a request waits, to look at the
// database mid call.
type Body = Record<string, unknown>;

export function fakeOpenAi(key: string) {
  const calls: Body[] = [];
  let reply: { text: string | null; usage: { input_tokens: number; output_tokens: number } } = { text: "", usage: { input_tokens: 0, output_tokens: 0 } };
  let before: (() => Promise<void>) | null = null;
  let base = "";
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const answer = (status: number, body: unknown) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (request.headers.authorization !== `Bearer ${key}`) return answer(401, { error: { code: "invalid_api_key" } });
    if (request.url !== "/v1/responses") return answer(404, { error: { code: "not_found" } });
    const body = JSON.parse(Buffer.concat(chunks).toString()) as Body;
    calls.push(body);
    await before?.();
    if (reply.text === null) return answer(500, { error: { code: "server_error" } });
    answer(200, { id: `resp_${randomUUID()}`, object: "response", status: "completed", model: body.model, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: reply.text }] }], usage: { ...reply.usage, total_tokens: reply.usage.input_tokens + reply.usage.output_tokens } });
  });
  return {
    calls,
    get url() { return base; },
    answer(text: string | null, input_tokens = 0, output_tokens = 0) { reply = { text, usage: { input_tokens, output_tokens } }; },
    during(check: (() => Promise<void>) | null) { before = check; },
    listen: () => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => {
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      resolve();
    })),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
