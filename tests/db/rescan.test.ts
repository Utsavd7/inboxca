import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { localSupabase } from "../local-env";
import { EICAR, fakeClamd } from "../fixtures/fake-clamd";
import { pdf } from "../fixtures/pdf";
import { rescan } from "@/src/jobs/rescan";
import type { Job } from "@/src/jobs/runner";
import { localDrive, VIRUS_FOLDER } from "@/src/lib/drive";
import { receive } from "@/src/lib/intake";
import { handle } from "@/worker/handler";
import { connect } from "./db";

// The virus check fails closed (DPA: files are checked before they are opened): with the
// scanner away, a file that comes in is held under To check, unopened, and the owner is told;
// the rescan job tries it again until the scanner is back, then passes it or puts a virus away.
it("holds a file while the scanner is away, and checks it again when it is back", async () => {
  const local = localSupabase(), db = await connect(), firm = randomUUID();
  const drive = await mkdtemp(path.join(tmpdir(), "rescan-drive-"));
  const clamd = fakeClamd();
  clamd.listen(0, "127.0.0.1");
  await once(clamd, "listening");
  const port = String((clamd.address() as AddressInfo).port);
  vi.stubEnv("SUPABASE_URL", local.url);
  vi.stubEnv("SUPABASE_SECRET_KEY", local.secretKey);
  vi.stubEnv("DRIVE_LOCAL_DIR", drive);
  vi.stubEnv("SCAN_OPTIONAL", "");
  vi.stubEnv("FILE_WORKER_URL", "http://worker");
  vi.stubEnv("FILE_WORKER_SECRET", randomBytes(32).toString("hex"));
  vi.stubEnv("CLAMD_HOST", "127.0.0.1");
  const fetched = globalThis.fetch;
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => String(url).startsWith("http://worker/") ? handle(new Request(String(url), { ...init, duplex: "half" } as RequestInit)) : fetched(url, init));
  try {
    await db.query("insert into public.firms(id,name,state_code,status) values ($1,'Rescan Test Firm','24','active')", [firm]);
    const client = { id: (await db.query("insert into public.clients(firm_id,name,kind) values ($1,'Invented Traders','business') returning id", [firm])).rows[0].id as string, name: "Invented Traders" };
    await db.query("insert into public.connected_accounts(firm_id,kind,provider,address_enc,credentials_enc) values ($1,'drive','local','invented','invented')", [firm]);
    const alert = async () => (await db.query("select status from public.requests where firm_id = $1 and kind = 'alert' and reason_code = 'scan_down'", [firm])).rows.map((row) => row.status);
    const bill = Buffer.from(pdf("Invented bill"));

    // Scanner away: the file is held, not refused and not passed, and the owner is told once.
    vi.stubEnv("CLAMD_PORT", "1");
    const held = await receive(firm, null, client, { name: "bill.pdf", bytes: bill }, localDrive(drive));
    expect(held).toMatchObject({ scanned: false, held: true });
    await receive(firm, null, client, { name: "notes.txt", bytes: Buffer.from(EICAR) }, localDrive(drive));
    expect(await alert()).toEqual(["pending"]);

    const add = async (name: string, bytes: Buffer) => {
      await writeFile(path.join(drive, name), bytes);
      return (await db.query("insert into public.documents(firm_id,client_id,work_type,document_type,period_key,name,size,sha256,drive_file_id,status,details) values ($1,$2,'gst','Purchase bills','2026-09',$3,$4,$5,$3,'to_check','{\"held\":\"scan\"}') returning id", [firm, client.id, name, bytes.length, createHash("sha256").update(bytes).digest("hex")])).rows[0].id as string;
    };
    const paper = async (id: string) => (await db.query("select status, scanned_at, details from public.documents where id = $1", [id])).rows[0];
    const run = (id: string) => rescan({ entity_id: id, firm_id: firm } as Job, { markSending: async () => {} });
    const clean = await add("bill.pdf", bill), virus = await add("notes.txt", Buffer.from(`Invented notes\n${EICAR}\n`));

    // Still away: tried again later, nothing opened or passed.
    expect(await run(clean)).toEqual({ retry: "scanner_down", patient: true });
    expect(await paper(clean)).toMatchObject({ status: "to_check", scanned_at: null, details: { held: "scan" } });

    // Back: the clean file passes and is read; the virus goes to the owner's folder.
    vi.stubEnv("CLAMD_PORT", port);
    expect(await run(clean)).toEqual({ done: true });
    const passed = await paper(clean);
    expect(passed.scanned_at).toBeTruthy();
    expect(passed.details).toEqual({});
    expect((await db.query("select count(*)::int n from public.jobs where entity_id = $1 and kind = 'read_document'", [clean])).rows[0].n).toBe(1);
    expect(await alert()).toEqual(["pending"]);
    expect(await run(virus)).toEqual({ done: true });
    expect(await paper(virus)).toMatchObject({ status: "deleted" });
    expect(await readdir(path.join(drive, "InboxCA", VIRUS_FOLDER))).toContain("Invented Traders - notes.txt");
    expect((await db.query("select status from public.requests where firm_id = $1 and kind = 'alert' and reason_code = 'virus'", [firm])).rows).toEqual([{ status: "pending" }]);
    expect(await alert()).toEqual(["done"]);
  } finally {
    fetcher.mockRestore();
    vi.unstubAllEnvs();
    clamd.close();
    await db.query("begin");
    await db.query("select set_config('app.log_purge','on',true)");
    await db.query("delete from public.firms where id=$1", [firm]);
    await db.query("commit");
    await db.end();
  }
});
