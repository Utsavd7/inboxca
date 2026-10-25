import { createHash, createHmac } from "node:crypto";

// AWS Signature Version 4 over fetch, for AWS KMS and the S3 API of Backblaze B2, so the app
// needs no AWS SDK. Secrets sign each request and are never sent, logged or put in an error.
export type AwsCredentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
export type AwsScope = { service: string; region: string; credentials: AwsCredentials };

// "key id:secret" from one setting; without it, the standard AWS variables, which an AWS
// Lambda function's role sets (with a session token).
export function awsCredentials(value?: string): AwsCredentials | null {
  if (value) {
    const at = value.indexOf(":");
    return at > 0 && at < value.length - 1 ? { accessKeyId: value.slice(0, at), secretAccessKey: value.slice(at + 1) } : null;
  }
  const { AWS_ACCESS_KEY_ID: accessKeyId, AWS_SECRET_ACCESS_KEY: secretAccessKey, AWS_SESSION_TOKEN: sessionToken } = process.env;
  return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey, sessionToken } : null;
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();
// RFC 3986, as Signature Version 4 encodes names and values.
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

// The headers that sign one request: the given ones, x-amz-date, the body's checksum for S3,
// and Authorization. Paths here are plain names (ids, a bucket, "/"), which every service
// signs alike, so each part of the path is encoded once.
export function signedHeaders(method: string, url: string, headers: Record<string, string>, body: string | Uint8Array, scope: AwsScope, now = new Date()): Record<string, string> {
  const { host, pathname, searchParams } = new URL(url);
  const date = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const payload = sha256(body);
  const all: Record<string, string> = {
    ...Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, " ")])),
    host,
    "x-amz-date": date,
    ...(scope.service === "s3" && { "x-amz-content-sha256": payload }),
    ...(scope.credentials.sessionToken && { "x-amz-security-token": scope.credentials.sessionToken }),
  };
  const names = Object.keys(all).sort();
  const query = [...searchParams].map(([name, value]) => `${encode(name)}=${encode(value)}`).sort().join("&");
  const path = pathname.split("/").map((part) => encode(decodeURIComponent(part))).join("/");
  const request = [method, path, query, names.map((name) => `${name}:${all[name]}\n`).join(""), names.join(";"), payload].join("\n");
  const where = `${date.slice(0, 8)}/${scope.region}/${scope.service}/aws4_request`;
  let key = hmac(`AWS4${scope.credentials.secretAccessKey}`, date.slice(0, 8));
  for (const part of [scope.region, scope.service, "aws4_request"]) key = hmac(key, part);
  const signature = createHmac("sha256", key).update(["AWS4-HMAC-SHA256", date, where, sha256(request)].join("\n")).digest("hex");
  delete all.host; // fetch sets it from the address
  return { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${scope.credentials.accessKeyId}/${where}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
}

// One signed call, given 15 seconds, and tried once more when the service is busy or did not
// answer. Every call made through it is safe to repeat: KMS, a read, a write to the same name.
export async function awsFetch(method: string, url: string, headers: Record<string, string>, body: string | Uint8Array, scope: AwsScope) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { method, headers: signedHeaders(method, url, headers, body, scope), body: method === "GET" ? undefined : (body as BodyInit), signal: AbortSignal.timeout(15_000) }).catch((error: Error) => error);
    const busy = response instanceof Error || response.status === 429 || response.status >= 500;
    if (!busy || attempt) {
      if (response instanceof Error) throw new Error(`${scope.service} did not answer`);
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 300));
  }
}
