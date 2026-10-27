import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// A stand in for OpenAI's Responses API (POST /v1/responses), so the AI features run in tests
// with no real key and no paid call. It takes only the key made in the same test run, answers
// each request with the next canned reply (none left: a server error, as when AI is paused),
// and keeps what it was asked for the test to read. route() sends the app's calls to
// api.openai.com here instead.
export async function fakeOpenAi(key: string) {
  const asked: { reason?: string; instructions: string; input: string; store: unknown }[] = [];
  const replies: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      if (request.method !== "POST" || request.url !== "/v1/responses" || request.headers.authorization !== `Bearer ${key}`) return void response.writeHead(401).end();
      const ask = JSON.parse(body);
      asked.push({ reason: ask.metadata?.reason, instructions: ask.instructions, input: ask.input, store: ask.store });
      const text = replies.shift();
      if (text === undefined) return void response.writeHead(500).end();
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text }] }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const real = globalThis.fetch;
  const route: typeof fetch = (input, init) => real(typeof input === "string" && input.startsWith("https://api.openai.com/") ? input.replace("https://api.openai.com", url) : input, init);
  return { url, asked, replies, route, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
