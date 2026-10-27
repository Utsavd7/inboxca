// The firm's key for this run only, kept in memory.
vi.mock("@/src/lib/crypto", async (actual) => {
  const real = await actual<typeof import("@/src/lib/crypto")>(), keys = new Map<string, Buffer>();
  const crypto = real.firmCrypto(real.localKek((await import("node:crypto")).randomBytes(32)), { read: async (firm) => keys.get(firm) ?? null, write: async (firm, wrapped) => (keys.set(firm, wrapped), true) });
  return { ...real, serverCrypto: () => crypto };
});
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { expect, it, vi } from "vitest";
import { localSupabase } from "../local-env";
import { readDocument } from "@/src/jobs/read-document";
import type { Job } from "@/src/jobs/runner";
import { filePeriod, folderFor } from "@/src/lib/documents";
import { fileName } from "@/src/lib/drive";
import { searchTokens, words } from "@/src/lib/search";
import { handle } from "@/worker/handler";
import { connect } from "./db";

// Read once (PLAN.md 5.4, D29), against the database: a paper's file is read from the drive
// once and its text kept sealed; a rename, an exact copy from the same client and the same
// register saved again with other bytes are not read for figures again; a changed one is.
// A picture's words are read by OCR in the file worker and kept the same way.
it("reads a paper's file once, and a new version for figures only when its content changed", async () => {
  const local = localSupabase(), db = await connect(), firm = randomUUID();
  const drive = await mkdtemp(path.join(tmpdir(), "read-once-drive-")), store = await mkdtemp(path.join(tmpdir(), "read-once-store-"));
  vi.stubEnv("SUPABASE_URL", local.url);
  vi.stubEnv("SUPABASE_SECRET_KEY", local.secretKey);
  vi.stubEnv("DRIVE_LOCAL_DIR", drive);
  vi.stubEnv("WORKSPACE_LOCAL_DIR", store);
  // The file worker answers in this process, as in the worker's own tests.
  vi.stubEnv("FILE_WORKER_URL", "http://worker");
  vi.stubEnv("FILE_WORKER_SECRET", randomBytes(32).toString("hex"));
  const fetched = globalThis.fetch;
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => String(url).startsWith("http://worker/") ? handle(new Request(String(url), { ...init, duplex: "half" } as RequestInit)) : fetched(url, init));
  try {
    await db.query("insert into public.firms(id,name,state_code,status) values ($1,'Read Once Test Firm','24','active')", [firm]);
    const [client, other] = (await db.query("insert into public.clients(firm_id,name,kind) values ($1,'Invented Traders','business'),($1,'Invented Exports','business') returning id", [firm])).rows.map((row) => row.id as string);
    await db.query("insert into public.connected_accounts(firm_id,kind,provider,address_enc,credentials_enc) values ($1,'drive','local','invented','invented')", [firm]);
    const register = (total: string, end = "\n") => Buffer.from(`Invoice,Total${end}INV-41,${total}${end}`);
    let hoursAgo = 5;
    // A sales register for September, its file in the drive or (null) not there.
    const add = async (owner: string, bytes: Buffer, file: string | null, name = "register.csv") => {
      if (file) await writeFile(path.join(drive, file), bytes);
      const values = [firm, owner, bytes.length, createHash("sha256").update(bytes).digest("hex"), file ?? `not-in-drive-${randomUUID()}`, hoursAgo--, name];
      return (await db.query("insert into public.documents(firm_id,client_id,work_type,document_type,period_key,name,size,sha256,drive_file_id,received_at) values ($1,$2,'gst','Sales register','2026-09',$7,$3,$4,$5,now() - make_interval(hours => $6)) returning id", values)).rows[0].id as string;
    };
    const read = (id: string) => readDocument({ entity_id: id, firm_id: firm } as Job, { markSending: async () => {} });
    const fingerprint = async (id: string) => (await db.query("select fingerprint from public.documents where id = $1", [id])).rows[0].fingerprint;
    const readForFigures = async (id: string) => Number((await db.query("select count(*) from public.jobs where entity_id = $1 and kind = 'read_sales'", [id])).rows[0].count);

    const first = await add(client, register("1180"), "first.csv");
    expect(await read(first)).toEqual({ done: true });
    const { fingerprint: mark, details } = (await db.query("select fingerprint, details from public.documents where id = $1", [first])).rows[0];
    expect(mark).toBeTruthy();
    expect((await readFile(path.join(store, details.text.key))).includes("INV-41")).toBe(false);
    expect(await readForFigures(first)).toBe(1);
    // Its file gone from the drive, a rename still reads it, from the kept text.
    await rm(path.join(drive, "first.csv"));
    expect(await read(first)).toEqual({ done: true });
    const copy = await add(client, register("1180"), null);
    expect(await read(copy)).toEqual({ done: true });
    expect(await fingerprint(copy)).toBe(mark);
    expect(await readForFigures(copy)).toBe(0);
    const resaved = await add(client, register("1180", "\r\n"), "resaved.csv");
    expect(await read(resaved)).toEqual({ done: true });
    expect(await fingerprint(resaved)).toBe(mark);
    expect(await readForFigures(resaved)).toBe(0);
    const changed = await add(client, register("1190"), "changed.csv");
    expect(await read(changed)).toEqual({ done: true });
    expect(await fingerprint(changed)).not.toBe(mark);
    expect(await readForFigures(changed)).toBe(1);
    // Another client's exact copy reuses nothing of this client's: it needs its own file.
    expect(await read(await add(other, register("1180"), null))).toEqual({ retry: "drive_unreachable", patient: true });

    // A paper under To check with the same content is filed as this client's register is: in its
    // folder, beside a file already under the plain name, which stays as it was; logged for Undo.
    // Another client's paper with the same content stays under To check.
    const waiting = async (owner: string, file: string) => {
      const bytes = register("1180", "\n\n");
      await writeFile(path.join(drive, file), bytes);
      return (await db.query("insert into public.documents(firm_id,client_id,work_type,document_type,period_key,status,name,size,sha256,drive_file_id) values ($1,$2,'other','Document','','to_check',$3,$4,$5,$3) returning id", [firm, owner, file, bytes.length, createHash("sha256").update(bytes).digest("hex")])).rows[0].id as string;
    };
    const folder = path.join("InboxCA", ...folderFor("year_client_work", "Invented Traders", { work: "gst", period: "2026-09", receivedAt: "", toCheck: false }));
    const plain = path.join(folder, fileName({ client: "Invented Traders", type: "Sales register", period: filePeriod("2026-09"), extension: ".csv" }));
    await mkdir(path.join(drive, folder), { recursive: true });
    await writeFile(path.join(drive, plain), "Invented file already there");
    const [checked, others] = [await waiting(client, "scan.csv"), await waiting(other, "other-scan.csv")];
    expect(await read(checked)).toEqual({ done: true });
    expect(await read(others)).toEqual({ done: true });
    const paper = async (id: string) => (await db.query("select status, work_type, document_type, period_key, name, drive_file_id from public.documents where id = $1", [id])).rows[0];
    const filed = await paper(checked);
    expect(filed).toMatchObject({ status: "filed", work_type: "gst", document_type: "Sales register", period_key: "2026-09" });
    expect(path.dirname(filed.drive_file_id)).toBe(folder);
    expect(filed.drive_file_id).not.toBe(plain);
    expect(await readFile(path.join(drive, filed.drive_file_id))).toEqual(register("1180", "\n\n"));
    expect(await readFile(path.join(drive, plain), "utf8")).toBe("Invented file already there");
    expect((await db.query("select actor_id, details from public.activity_log where entity_id = $1 and action = 'document.renamed'", [checked])).rows).toEqual([
      { actor_id: null, details: { from: { work_type: "other", document_type: "Document", period_key: "", status: "to_check", name: "scan.csv", drive_file_id: "scan.csv" }, to: filed.name } },
    ]);
    expect(await paper(others)).toMatchObject({ status: "to_check", drive_file_id: "other-scan.csv" });

    // A photo of a letter, drawn here with invented words, is found by them once read by OCR.
    // Its text is sealed and keyed like any other, with what read it; an exact copy reuses it.
    GlobalFonts.registerFromPath(path.join("node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf"), "Invented Sans");
    const canvas = createCanvas(900, 160), context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, 900, 160);
    context.fillStyle = "black";
    context.font = "48px 'Invented Sans'";
    context.fillText("Zephyrine sanction letter", 30, 100);
    const photo = Buffer.from(await canvas.encode("jpeg", 90)), wanted = await searchTokens(firm, words("zephyrine sanction"));
    const found = async (id: string) => (await db.query("select details from public.documents where id = $1 and search_tokens @> $2", [id, wanted])).rows[0]?.details;
    const letter = await add(client, photo, "letter.jpg", "letter.jpg");
    expect(await read(letter)).toEqual({ done: true });
    const { text: kept } = await found(letter);
    expect(kept).toMatchObject({ kind: "ocr_text", engine: expect.stringMatching(/^tesseract\.js \d/), languages: ["eng"] });
    expect(kept.confidence).toBeGreaterThan(50);
    expect(await fingerprint(letter)).toBeTruthy();
    expect((await readFile(path.join(store, kept.key))).includes("Zephyrine")).toBe(false);
    expect(JSON.stringify((await db.query("select * from public.documents where id = $1", [letter])).rows[0]).toLowerCase()).not.toContain("zephyrine");
    const copied = await add(client, photo, null, "letter.jpg");
    expect(await read(copied)).toEqual({ done: true });
    expect((await found(copied)).text).toMatchObject({ kind: "ocr_text", languages: ["eng"], confidence: kept.confidence });
  } finally {
    fetcher.mockRestore();
    await db.query("begin");
    await db.query("select set_config('app.log_purge','on',true)");
    await db.query("delete from public.firms where id=$1", [firm]);
    await db.query("commit");
    await db.end();
    await Promise.all([drive, store].map((folder) => rm(folder, { recursive: true, force: true })));
    vi.unstubAllEnvs();
  }
});
