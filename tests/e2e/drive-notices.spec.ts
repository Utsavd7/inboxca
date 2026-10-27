import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { DROPBOX_TEST_SECRET } from "../../playwright.config";
import { localSupabase, query, seedFirm } from "./local-supabase";

// Dropbox's change notices (docs.dropboxapi.com/dropbox-api/docs/webhooks), against this test
// server's invented app secret.
const local = localSupabase();
const sign = (body: string) => createHmac("sha256", DROPBOX_TEST_SECRET).update(body).digest("hex");
// The drive checks queued for a drive: none runs yet, as each waits for the end of its 5 minutes.
const checks = (drive: string) => query(local.dbUrl, "select kind, run_at > now() as later, run_at <= now() + interval '5 minutes' as soon from public.jobs where entity_id = $1", [drive]);

test("Dropbox's check of the address gets its challenge back, as plain text only", async ({ request }) => {
  const response = await request.get("/api/drive/dropbox?challenge=invented-challenge-42");
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe("invented-challenge-42");
  expect(response.headers()["content-type"]).toMatch(/^text\/plain/);
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
});

test("a signed notice queues one check of the named firm's drive, and an unsigned one is refused", async ({ request }) => {
  test.skip(!local.dbUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
  const tag = randomUUID().replaceAll("-", "");
  const account = `dbid:AAInvented${tag}`;
  // The check it queues waits for the end of the 5 minutes, so it never reaches Dropbox here.
  const { firmId: firm, remove } = await seedFirm("Drive Notices Test Firm", `notices-${tag}@example.test`);
  const [{ id: drive }] = await query(
    local.dbUrl,
    "insert into public.connected_accounts (firm_id, kind, provider, address_enc, credentials_enc, settings) values ($1, 'drive', 'dropbox', 'invented', 'invented', $2) returning id",
    [firm, { level: "whole_drive", dropbox_account: createHash("sha256").update(account).digest("hex") }],
  );
  try {
    const body = JSON.stringify({ list_folder: { accounts: [account, "dbid:AAInventedSomeoneElse"] }, delta: { users: [12345678] } });
    const post = (signature: string) => request.post("/api/drive/dropbox", { data: body, headers: { "Content-Type": "application/json", "X-Dropbox-Signature": signature } });
    expect((await post(sign("another body"))).status()).toBe(403);
    expect((await request.post("/api/drive/dropbox", { data: body, headers: { "Content-Type": "application/json" } })).status()).toBe(403);
    expect(await checks(drive)).toEqual([]);

    // A burst of notices within the same 5 minutes is one check, at the end of them.
    const window = Math.floor(Date.now() / 300_000);
    expect((await post(sign(body))).status()).toBe(200);
    expect((await post(sign(body))).status()).toBe(200);
    const queued = await checks(drive);
    if (Math.floor(Date.now() / 300_000) === window) expect(queued).toEqual([{ kind: "drive_check", later: true, soon: true }]);
    else expect(queued.length).toBe(2);
  } finally {
    await remove();
  }
});

// OneDrive's (learn.microsoft.com/graph/change-notifications-delivery-webhooks): each watch's
// secret is made here, and the drive keeps only its hash, as watchDrive does.
test("Microsoft's check of the OneDrive address gets its token back, as plain text only", async ({ request }) => {
  const response = await request.post(`/api/drive/onedrive?validationToken=${encodeURIComponent("Validation: invented token 42")}`, { headers: { "Content-Type": "text/plain" } });
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe("Validation: invented token 42");
  expect(response.headers()["content-type"]).toMatch(/^text\/plain/);
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
});

test("a OneDrive notice with its watch's secret queues one check of that drive, and any other queues nothing", async ({ request }) => {
  test.skip(!local.dbUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
  const tag = randomUUID().replaceAll("-", "");
  const [watch, secret] = [randomUUID(), randomBytes(32).toString("base64url")];
  const hash = createHash("sha256").update(secret).digest("hex");
  const { firmId: firm, remove } = await seedFirm("OneDrive Notices Test Firm", `onedrive-notices-${tag}@example.test`);
  const [{ id: drive }] = await query(
    local.dbUrl,
    "insert into public.connected_accounts (firm_id, kind, provider, address_enc, credentials_enc, settings) values ($1, 'drive', 'onedrive', 'invented', 'invented', $2) returning id",
    [firm, { level: "whole_drive", onedrive_notices: { id: watch, until: new Date(Date.now() + 86_400_000).toISOString(), check: hash } }],
  );
  try {
    const post = (notice: object) => request.post("/api/drive/onedrive", { data: { value: [{ subscriptionId: watch, changeType: "updated", resource: "drives/invented/root", ...notice }] } });
    // Another secret, none, or the kept hash itself.
    for (const notice of [{ clientState: randomBytes(32).toString("base64url") }, {}, { clientState: hash }]) expect((await post(notice)).status()).toBe(202);
    expect(await checks(drive)).toEqual([]);

    // A change and a call to authorize the watch again, within the same 5 minutes: one check.
    const window = Math.floor(Date.now() / 300_000);
    expect((await post({ clientState: secret })).status()).toBe(202);
    expect((await post({ clientState: secret, lifecycleEvent: "reauthorizationRequired" })).status()).toBe(202);
    const queued = await checks(drive);
    if (Math.floor(Date.now() / 300_000) === window) expect(queued).toEqual([{ kind: "drive_check", later: true, soon: true }]);
    else expect(queued.length).toBe(2);
  } finally {
    await remove();
  }
});
