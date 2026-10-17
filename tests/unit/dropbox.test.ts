import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dropboxSignIn, pkce } from "@/src/lib/dropbox";

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
