// What a download address answers when it cannot give the file: a short page in plain words
// with the way back, never bare text on an empty browser tab. The status code stays.
const escape = (text: string) => text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

export function plainPage(status: number, words: string, back: string, backWords: string, headers: Record<string, string> = {}) {
  return new Response(
    `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>InboxCA</title></head><body style="font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:12vh auto;padding:0 1rem"><p><strong>InboxCA</strong></p><h1 style="font-size:1.25rem">${escape(words)}</h1><p><a href="${escape(back)}">${escape(backWords)}</a></p></body></html>`,
    { status, headers: { "Cache-Control": "private, no-store", ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff" } },
  );
}
