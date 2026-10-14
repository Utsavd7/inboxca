import { redact } from "./logger";

// Server errors to Sentry, scrubbed (PLAN.md 8.9): an error's type, where in the code it
// happened and which route, never its message, the request's path, headers or cookies,
// since any of those can hold client details. No SDK, so nothing reaches the browser
// bundle and it runs wherever the app runs. Off until SENTRY_DSN is set.

type Tags = Record<string, string | undefined>;

export function parseDsn(dsn: string | undefined) {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const project = url.pathname.replace(/^\/+|\/+$/g, "");
    if (!url.username || !/^\d+$/.test(project)) return null;
    return { key: url.username, endpoint: `${url.protocol}//${url.host}/api/${project}/envelope/` };
  } catch {
    return null;
  }
}

// Stack lines as Sentry frames, oldest call first, with paths cut to the app's own part.
function frames(stack: string | undefined) {
  return (stack ?? "")
    .split("\n")
    .map((line) => line.match(/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/))
    .filter((match) => match !== null)
    .map(([, fn, file, line, column]) => ({
      function: fn ?? "?",
      filename: file.replace(/^file:\/\//, "").replace(/^.*?(\.next\/|node_modules\/)/, "$1"),
      lineno: Number(line),
      colno: Number(column),
    }))
    .reverse();
}

export function errorEvent(error: unknown, tags: Tags = {}) {
  const type = error instanceof Error ? error.name : typeof error;
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String(error.digest)
      : undefined;
  return {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    environment: process.env.NODE_ENV,
    exception: {
      values: [
        {
          type,
          ...(error instanceof Error && { stacktrace: { frames: frames(error.stack) } }),
        },
      ],
    },
    tags: redact({ ...tags, digest }) as Tags,
  };
}

// Never throws and never waits more than 3 seconds: reporting must not break a request.
export async function reportError(error: unknown, tags: Tags = {}) {
  const dsn = parseDsn(process.env.SENTRY_DSN);
  if (!dsn) return;
  const event = errorEvent(error, tags);
  const body = [
    JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
  try {
    await fetch(dsn.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=inboxca/1`,
      },
      body,
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Sentry unreachable: the structured log line still has the error.
  }
}
