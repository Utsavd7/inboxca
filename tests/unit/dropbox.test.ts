import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { dropboxAccountKey, dropboxDrive, dropboxNotice, dropboxSignIn, pkce } from "@/src/lib/dropbox";

describe("Dropbox's change notices", () => {
  // An invented app secret and invented account ids, in the layout Dropbox's webhook page shows.
  const secret = "invented-app-secret";
  const body = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const sign = (bytes: Uint8Array, key = secret) => createHmac("sha256", key).update(bytes).digest("hex");
  const sent = body({ list_folder: { accounts: ["dbid:AAInventedOne", "dbid:AAInventedTwo", "dbid:AAInventedOne"] }, delta: { users: [12345678] } });

  it("takes a notice signed with the app secret, naming each account once by its hash", () => {
    expect(dropboxNotice(sent, sign(sent), secret)).toEqual([dropboxAccountKey("dbid:AAInventedOne"), dropboxAccountKey("dbid:AAInventedTwo")]);
    expect(dropboxAccountKey("dbid:AAInventedOne")).toBe(createHash("sha256").update("dbid:AAInventedOne").digest("hex"));
  });

  it("refuses one with no signature, another key's signature, or a changed body", () => {
    expect(dropboxNotice(sent, null, secret)).toBeNull();
    expect(dropboxNotice(sent, "not hex", secret)).toBeNull();
    expect(dropboxNotice(sent, sign(sent, "another-secret"), secret)).toBeNull();
    expect(dropboxNotice(body({ list_folder: { accounts: ["dbid:AAInventedThree"] } }), sign(sent), secret)).toBeNull();
  });

  it("names nobody in a signed notice it cannot read", () => {
    for (const bytes of [new TextEncoder().encode("not json"), body({ delta: { users: [1] } }), body({ list_folder: { accounts: [7] } })])
      expect(dropboxNotice(bytes, sign(bytes), secret)).toEqual([]);
  });
});

describe("signing in to Dropbox", () => {
  it("sends Dropbox only the PKCE challenge, and asks for a refresh token", () => {
    const { verifier, challenge } = pkce();
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);
    const url = new URL(dropboxSignIn("state-1", challenge, "http://127.0.0.1:3000/api/drive/callback"));
    expect(url.searchParams.get("code_challenge")).toBe(challenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("token_access_type")).toBe("offline");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.toString()).not.toContain(verifier);
  });
});

it("gives the browser a one-time link into Incoming, and reads back the checksum Dropbox keeps", async () => {
  const sent: unknown[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("/oauth2/token")) return Response.json({ access_token: "invented" });
    const body = JSON.parse(String(init.body));
    sent.push(body);
    if (url.endsWith("files/get_temporary_upload_link")) return Response.json({ link: "https://content.dropboxapi.com/apitul/1/invented" });
    if (body.path.endsWith("missing.pdf")) return Response.json({ error_summary: "path/not_found/." }, { status: 409 });
    return Response.json({ id: "id:invented", content_hash: "abc" });
  });
  try {
    const drive = dropboxDrive("invented-refresh-token");
    expect(await drive.incomingLink("Old files/ITR-V.pdf")).toBe("https://content.dropboxapi.com/apitul/1/invented");
    expect(sent[0]).toEqual({ commit_info: { path: "/InboxCA/Incoming/Old files/ITR-V.pdf", mode: "add", autorename: false, mute: true }, duration: 14400 });
    expect(await drive.incomingFile("Old files/ITR-V.pdf")).toEqual({ id: "id:invented", hash: "abc" });
    expect(await drive.incomingFile("Old files/missing.pdf")).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("lists one folder below /InboxCA a page at a time, and an absent folder as empty", async () => {
  const sent: { url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("/oauth2/token")) return Response.json({ access_token: "invented" });
    const body = JSON.parse(String(init.body));
    sent.push({ url, body });
    if (body.path === "/InboxCA/Gone") return Response.json({ error_summary: "path/not_found/." }, { status: 409 });
    if (url.endsWith("files/list_folder"))
      return Response.json({
        entries: [
          { ".tag": "folder", id: "id:f", name: "GST", path_display: "/InboxCA/FY 2026-27/Patel Textiles/GST" },
          { ".tag": "file", id: "id:a", name: "a.pdf", path_display: "/InboxCA/FY 2026-27/Patel Textiles/a.pdf", size: 12, server_modified: "2026-10-01T10:00:00Z" },
        ],
        has_more: true,
        cursor: "next",
      });
    return Response.json({ entries: [], has_more: false });
  });
  try {
    const drive = dropboxDrive("invented-refresh-token");
    expect(await drive.list("FY 2026-27/Patel Textiles", undefined, 2)).toEqual({
      entries: [
        { id: "id:f", name: "GST", path: "FY 2026-27/Patel Textiles/GST", folder: true, size: 0, modified: "" },
        { id: "id:a", name: "a.pdf", path: "FY 2026-27/Patel Textiles/a.pdf", folder: false, size: 12, modified: "2026-10-01T10:00:00Z" },
      ],
      cursor: "next",
    });
    expect(sent[0].body).toEqual({ path: "/InboxCA/FY 2026-27/Patel Textiles", limit: 2 });
    expect(await drive.list("FY 2026-27/Patel Textiles", "next")).toEqual({ entries: [], cursor: null });
    expect(sent[1]).toEqual({ url: "https://api.dropboxapi.com/2/files/list_folder/continue", body: { cursor: "next" } });
    expect(await drive.list("Gone")).toEqual({ entries: [], cursor: null });
  } finally {
    vi.unstubAllGlobals();
  }
});
