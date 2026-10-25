import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { signedHeaders, type AwsCredentials } from "@/src/lib/aws";

// Invented keys for the fake services below; never real ones.
export const testCredentials: AwsCredentials = { accessKeyId: "AKIDINVENTED", secretAccessKey: "invented/secret+key" };

export type Received = { method: string; path: string; headers: Record<string, string>; body: Buffer };

// A small fake AWS service on this computer. Each request's signature is checked again from
// what arrived (its signed headers, path, query and body) with the test keys, for this service
// and region; a request that does not match is refused with 403 as AWS does. Passing ones go to
// answer().
export async function fakeAws(service: string, region: string, answer: (request: Received) => { status?: number; json?: object; body?: Uint8Array }) {
  const requests: Received[] = [];
  const server = createServer((incoming, reply) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk) => chunks.push(chunk)).on("end", () => {
      const headers = Object.fromEntries(Object.entries(incoming.headers).map(([name, value]) => [name, String(value)]));
      const request = { method: incoming.method!, path: incoming.url!, headers, body: Buffer.concat(chunks) };
      requests.push(request);
      const send = ({ status = 200, json, body }: { status?: number; json?: object; body?: Uint8Array }) =>
        reply.writeHead(status, json ? { "content-type": "application/json" } : {}).end(json ? JSON.stringify(json) : body);
      if (!signatureHolds(request, service, region)) return send({ status: 403, json: { __type: "com.amazon.coral.service#InvalidSignatureException", message: "The request signature we calculated does not match" } });
      send(answer(request));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

function signatureHolds({ method, path, headers, body }: Received, service: string, region: string) {
  const given = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, SignedHeaders=([^,]+), Signature=[0-9a-f]{64}$/.exec(headers.authorization ?? "");
  if (!given || given[1] !== testCredentials.accessKeyId || given[3] !== region || given[4] !== service) return false;
  if (service === "s3" && headers["x-amz-content-sha256"] !== createHash("sha256").update(body).digest("hex")) return false;
  const date = headers["x-amz-date"] ?? "";
  const at = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`);
  if (date.slice(0, 8) !== given[2] || Math.abs(Date.now() - at.getTime()) > 5 * 60_000) return false;
  const added = new Set(["host", "x-amz-date", "x-amz-content-sha256", "x-amz-security-token"]);
  const signed = Object.fromEntries(given[5].split(";").filter((name) => !added.has(name)).map((name) => [name, headers[name] ?? ""]));
  return signedHeaders(method, `http://${headers.host}${path}`, signed, body, { service, region, credentials: { ...testCredentials, sessionToken: headers["x-amz-security-token"] } }, at).authorization === headers.authorization;
}
