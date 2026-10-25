// Structured JSON logs that never carry client content or identifiers (PLAN.md 8.9):
// no email text, file names, PAN, GSTIN, Aadhaar, phone numbers or email addresses.

const HIDDEN = "[redacted]";

// Fields whose value is dropped whole, whatever it holds.
const hiddenKeys =
  /^(body|text|html|subject|snippet|content|filename|file_name|password|passcode|otp|token|access_token|refresh_token|secret|api_key|apikey|authorization|cookie|set-cookie|aadhaar|pan|gstin|phone|email)$/i;

// Identifiers masked wherever they appear inside a value. Tokens first: a signed token, a
// Bearer header, or any long run of key characters (link tokens, keys, encrypted values).
const patterns: [RegExp, string][] = [
  [/\b(Bearer|Basic)\s+\S+/gi, "$1 [token]"],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[token]"],
  [/[\w-]{40,}/g, "[token]"],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]"],
  // An IP address: four dotted numbers (with any IPv6 prefix or port), or IPv6 with three or
  // more colons or a "::". A time has two colons, so it stays.
  [/(?:[0-9a-f]{0,4}(?::[0-9a-f]{0,4})*:)?\b(?:\d{1,3}\.){3}\d{1,3}\b(?::\d{1,5})?|(?:\b[0-9a-f]{1,4})?(?::[0-9a-f]{0,4}){3,7}|\b[0-9a-f]{1,4}::(?:[0-9a-f]{1,4})?/gi, "[ip]"],
  [/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g, "[gstin]"],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[pan]"],
  [/\b\d{4}\s?\d{4}\s?\d{4}\b/g, "[aadhaar]"],
  [/(?:\+91[\s-]?)?\b[6-9]\d{9}\b/g, "[phone]"],
];

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return HIDDEN;
  if (typeof value === "string")
    return patterns.reduce((text, [pattern, mask]) => text.replace(pattern, mask), value);
  if (value instanceof Error)
    return { name: value.name, message: redact(value.message, depth + 1) };
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        hiddenKeys.test(key) ? HIDDEN : redact(item, depth + 1),
      ]),
    );
  return value;
}

type Level = "debug" | "info" | "warn" | "error";

function write(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    event,
    ...(redact(fields) as Record<string, unknown>),
  });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => write("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => write("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write("error", event, fields),
};
