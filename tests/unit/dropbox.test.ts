import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { dropboxDrive, dropboxSignIn, pkce } from "@/src/lib/dropbox";

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
