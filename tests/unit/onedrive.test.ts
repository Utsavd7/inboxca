import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pkce } from "@/src/lib/dropbox";
import { onedriveAccessToken, onedriveConnect, onedriveDrive, onedriveSignIn, onedriveUnwatch, onedriveWatch, watchCheck } from "@/src/lib/onedrive";
import { PIECE, quickXorHash, sendPieces } from "@/src/lib/onedrive-upload";
import { fakeOneDrive, fakeOneDriveKeys } from "../fake-onedrive";

// OneDrive against the fake Microsoft sign in and Graph in tests/fake-onedrive.ts, answered in
// memory: no network, no Microsoft account.
let fake: ReturnType<typeof fakeOneDrive>;
const redirect = "http://127.0.0.1:3000/api/drive/callback";
beforeEach(() => {
  fake = fakeOneDrive();
  vi.stubEnv("MAIL_ALLOW_LOCAL", "1");
  vi.stubEnv("ONEDRIVE_TEST_URL", "http://onedrive.test");
  for (const [name, value] of Object.entries(fakeOneDriveKeys)) vi.stubEnv(name, value);
  vi.stubGlobal("fetch", fake.fetch);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// The owner presses Allow on the fake sign in page; its answer is the code and state.
async function signedIn(keep?: (token: string) => Promise<unknown>) {
  const { verifier, challenge } = pkce();
  const back = new URL((await fetch(onedriveSignIn("state-1", challenge, redirect))).headers.get("location")!);
  const connected = await onedriveConnect(back.searchParams.get("code")!, verifier, redirect);
  return { ...connected, drive: onedriveDrive(connected.refreshToken, keep) };
}

describe("signing in to OneDrive", () => {
  it("asks Microsoft's common sign in for the owner's files with a PKCE challenge only", () => {
    const { verifier, challenge } = pkce();
    const url = new URL(onedriveSignIn("state-1", challenge, redirect));
    expect(url.pathname).toBe("/login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "test-onedrive-client", response_type: "code", redirect_uri: redirect, scope: "offline_access User.Read Files.ReadWrite", code_challenge: challenge, code_challenge_method: "S256", state: "state-1" });
    expect(url.toString()).not.toContain(verifier);
  });

  it("exchanges the code for a refresh token, the owner's address and the drive's hash, and refuses another verifier", async () => {
    const { refreshToken, email, account } = await signedIn();
    expect(refreshToken).toMatch(/^refresh-/);
    expect(email).toBe(fake.drive.email);
    expect(account).toBe(createHash("sha256").update(fake.drive.id).digest("hex"));
    const back = new URL((await fetch(onedriveSignIn("state-2", pkce().challenge, redirect))).headers.get("location")!);
    await expect(onedriveConnect(back.searchParams.get("code")!, pkce().verifier, redirect)).rejects.toThrow("onedrive_token_400");
  });

  it("hands each new refresh token to keep, as Microsoft renews it at every use", async () => {
    const kept: string[] = [];
    const { drive, refreshToken } = await signedIn(async (token) => kept.push(token));
    await drive.ensureFolder([]);
    expect(kept).toHaveLength(1);
    expect(kept[0]).not.toBe(refreshToken);
  });
});

describe("the firm's OneDrive", () => {
  it("makes folders below /InboxCA, saves without overwriting, and reads back", async () => {
    const { drive } = await signedIn();
    expect(await drive.ensureFolder(["FY 2026-27", "Patel & Sons", "GST"])).toBe("/InboxCA/FY 2026-27/Patel & Sons/GST");
    expect(await drive.ensureFolder(["FY 2026-27", "Patel & Sons", "GST"])).toBe("/InboxCA/FY 2026-27/Patel & Sons/GST");
    const saved = await drive.save("/InboxCA/FY 2026-27/Patel & Sons/GST", "Sales bills.pdf", new TextEncoder().encode("invented"));
    expect(saved).toEqual({ id: fake.file("/InboxCA/FY 2026-27/Patel & Sons/GST/Sales bills.pdf")!.id });
    expect(await drive.save("/InboxCA/FY 2026-27/Patel & Sons/GST", "sales bills.pdf", new TextEncoder().encode("other"))).toBe("taken");
    expect(new TextDecoder().decode(await drive.read((saved as { id: string }).id))).toBe("invented");
  });

  it("sends a file over 10 MiB in an upload session, in pieces of 10 MiB", async () => {
    const { drive } = await signedIn();
    const folder = await drive.ensureFolder(["Big"]);
    const bytes = new Uint8Array(PIECE + 1024).map((_, index) => index % 251);
    const saved = await drive.save(folder, "scan.pdf", bytes);
    expect(fake.drive.pieces).toEqual([`bytes 0-${PIECE - 1}/${bytes.length}`, `bytes ${PIECE}-${bytes.length - 1}/${bytes.length}`]);
    expect(Buffer.from(await drive.read((saved as { id: string }).id)).equals(Buffer.from(bytes))).toBe(true);
    expect(await drive.save(folder, "scan.pdf", bytes)).toBe("taken");
  });

  it("moves and renames by id, refusing a name already taken, and trashes once", async () => {
    const { drive } = await signedIn();
    const from = await drive.ensureFolder(["To check"]);
    const to = await drive.ensureFolder(["FY 2026-27", "GST"]);
    const one = (await drive.save(from, "a.pdf", new Uint8Array([1]))) as { id: string };
    await drive.save(to, "b.pdf", new Uint8Array([2]));
    expect(await drive.move(one.id, to, "b.pdf")).toBe("taken");
    expect(await drive.move(one.id, to, "c.pdf")).toEqual({ id: one.id });
    expect(fake.file("/InboxCA/FY 2026-27/GST/c.pdf")?.id).toBe(one.id);
    await drive.trash(one.id);
    await drive.trash(one.id);
    expect(fake.file("/InboxCA/FY 2026-27/GST/c.pdf")).toBeUndefined();
  });

  it("lists one folder below /InboxCA a page at a time, an absent one as empty, each page of the folder asked for", async () => {
    const { drive } = await signedIn();
    const folder = await drive.ensureFolder(["FY 2026-27"]);
    for (const name of ["a.pdf", "b.pdf", "c.pdf"]) await drive.save(folder, name, new Uint8Array([1, 2]));
    await drive.ensureFolder(["FY 2026-27", "GST"]);
    const first = await drive.list("FY 2026-27");
    expect(first.entries.map(({ name, path, folder, size }) => ({ name, path, folder, size }))).toEqual([
      { name: "a.pdf", path: "FY 2026-27/a.pdf", folder: false, size: 2 },
      { name: "b.pdf", path: "FY 2026-27/b.pdf", folder: false, size: 2 },
      { name: "c.pdf", path: "FY 2026-27/c.pdf", folder: false, size: 2 },
    ]);
    // The browser keeps only Graph's page token, never an address the access token would go to.
    expect(first.cursor).toBe("3");
    expect(await drive.list("FY 2026-27", first.cursor!)).toMatchObject({ entries: [{ name: "GST", path: "FY 2026-27/GST", folder: true, size: 0, modified: "" }], cursor: null });
    expect(await drive.list("Gone")).toEqual({ entries: [], cursor: null });
    const asked: string[] = [];
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) => (asked.push(String(input)), fake.fetch(input, init)));
    expect((await drive.list("FY 2026-27", "https://invented.test/elsewhere")).entries[0].path).toBe("FY 2026-27/a.pdf");
    expect(asked.every((url) => url.startsWith("http://onedrive.test/graph.microsoft.com/v1.0/me/drive/root:/InboxCA/FY%202026-27:/children?"))).toBe(true);
  });

  it("lists the drive's own top folders and Incoming, and every file below one from the change list", async () => {
    const { drive } = await signedIn();
    const root = fake.drive.items.get("root")!.id;
    fake.drive.items.set("old", { id: "old", name: "Old clients", parent: root, modified: "" });
    fake.drive.items.set("patel", { id: "patel", name: "Patel", parent: "old", modified: "" });
    fake.drive.items.set("itr", { id: "itr", name: "ITR-V.pdf", parent: "patel", bytes: Buffer.from("x"), modified: "" });
    fake.drive.items.set("loose", { id: "loose", name: "notes.txt", parent: root, bytes: Buffer.from("y"), modified: "" });
    await drive.ensureFolder([]);
    expect(await drive.folders()).toEqual(["/Old clients"]);
    await drive.ensureFolder(["Incoming"]);
    expect(await drive.folders()).toEqual(["/Old clients", "/InboxCA/Incoming"]);
    expect(await drive.files("/Old clients")).toEqual([{ id: "itr", path: "/Old clients/Patel/ITR-V.pdf", size: 1 }]);
  });

  it("checks InboxCA's folder: its files by id and path, whether anyone else shares it, and the space left", async () => {
    const { drive } = await signedIn();
    const folder = await drive.ensureFolder(["FY 2026-27", "To check"]);
    const saved = (await drive.save(folder, "a.pdf", new Uint8Array([1]))) as { id: string };
    expect(await drive.check()).toEqual({ files: [{ id: saved.id, path: "/InboxCA/FY 2026-27/To check/a.pdf" }], shared: false, freeBytes: 1024 ** 4 });
    fake.drive.shared = true;
    fake.drive.remaining = undefined;
    expect(await drive.check()).toMatchObject({ shared: true, freeBytes: null });
  });

  it("gives the browser an upload session in Incoming, and reads back OneDrive's checksum of what it sent", async () => {
    const { drive } = await signedIn();
    const link = await drive.incomingLink("Old files/2024/ITR-V.pdf");
    expect(link).toMatch(/^http:\/\/onedrive\.test\/upload\//);
    const file = new Blob([new Uint8Array(PIECE * 2 + 7).fill(9)]);
    expect((await sendPieces(link, file)).status).toBe(201);
    expect(fake.drive.pieces).toHaveLength(3);
    expect(await drive.incomingFile("Old files/2024/ITR-V.pdf")).toEqual({ id: fake.file("/InboxCA/Incoming/Old files/2024/ITR-V.pdf")!.id, hash: await quickXorHash(file) });
    expect(await drive.incomingFile("Old files/2024/missing.pdf")).toBeNull();
  });

  it("watches the drive's top for change notices, renews the watch, makes it again when gone, and removes it", async () => {
    const token = await onedriveAccessToken((await signedIn()).refreshToken);
    const address = "https://inboxca.invalid/api/drive/onedrive";
    const made = await onedriveWatch(token, address);
    const kept = fake.drive.watches.get(made.id)!;
    expect(kept).toMatchObject({ resource: "me/drive/root", changeType: "updated", notificationUrl: address, lifecycleNotificationUrl: address, expirationDateTime: made.until });
    // InboxCA keeps only the hash of the secret each notice carries.
    expect(made.check).toBe(watchCheck(kept.clientState));
    // Renewed: the same watch and secret, with a new end.
    const renewed = await onedriveWatch(token, address, made.id);
    expect(renewed).toEqual({ id: made.id, until: expect.any(String) });
    expect(fake.drive.watches.get(made.id)).toMatchObject({ clientState: kept.clientState, expirationDateTime: renewed.until });
    // Gone at Microsoft: a new one with a new secret. One left from before (409) is replaced.
    fake.drive.watches.clear();
    const again = await onedriveWatch(token, address, made.id);
    expect(again.id).not.toBe(made.id);
    expect(again.check).not.toBe(made.check);
    const replaced = await onedriveWatch(token, address);
    expect([...fake.drive.watches.keys()]).toEqual([replaced.id]);
    // Removed at Disconnect, and removing it again is no error.
    await onedriveUnwatch(token, replaced.id);
    await onedriveUnwatch(token, replaced.id);
    expect(fake.drive.watches.size).toBe(0);
  });
});

// Vectors from rclone's tests of the same algorithm (backend/onedrive/quickxorhash).
it("works out quickXorHash as OneDrive does", async () => {
  const vectors: [string, string][] = [
    ["", "AAAAAAAAAAAAAAAAAAAAAAAAAAA="],
    ["Sg==", "SgAAAAAAAAAAAAAAAQAAAAAAAAA="],
    ["jRRDVA==", "jaDAEKgAAAAAAAAABAAAAAAAAAA="],
    ["T6LYJIfDh81JrAK309H2JMJTXis=", "zBTHrspn3mEcohlJdIUAbjGNaNg="],
    ["PwXNnutoLLmxD8TTog52k8cQkukmT87TTnDipKLHQw==", "PTaGs7yV3FUyBy/SfU6xJRlCJlI="],
    [
      "qwGf2ESubE5jOUHHyc94ORczFYYbc2OmEzo+hBIyzJiNwAzC8PvJqtTzwkWkSslgHFGWQZR2BV5+uYTrYT7HVwRM40vqfj0dBgeDENyTenIOL1LHkjtDKoXEnQ0mXAHoJ8PjbNC93zi5TovVRXTNzfGEs5dpWVqxUzb5lc7dwkyvOluBw482mQ4xrzYyIY1t+//OrNi1ObGXuUw2jBQOFfJVj2Y6BOyYmfB1y36eBxi3zxeG5d5NYjm2GSh6e08QMAwu3zrINcqIzLOuNIiGXBtl7DjKt7b5wqi4oFiRpZsCyx2smhSrdrtK/CkdU6nDN+34vSR/M8rZpWQdBE7a8g==",
      "WYT9JY3JIo/pEBp+tIM6Gt2nyTM=",
    ],
  ];
  for (const [input, hash] of vectors) expect(await quickXorHash(new Blob([Buffer.from(input, "base64")]))).toBe(hash);
});
