import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { signView, readFrames } from "@/src/lib/file-worker";
import { writeWorkbook } from "@/worker/workbook";
import { demoFiles } from "@/scripts/demo-files.mts";

const render = vi.hoisted(() => ({ render: vi.fn(async () => Uint8Array.of(1, 137, 80, 78, 71)), dispose: vi.fn() }));
vi.mock("@/worker/render.ts", () => ({ openView: vi.fn(async () => ({ header: { pages: [{ width: 12, height: 12 }, { width: 12, height: 12 }], limited: false }, ...render })) }));
import { handle } from "@/worker/handler";

it("streams the first page without rendering the rest, then releases on disconnect", async () => {
  const root = await mkdtemp(join(tmpdir(), "viewer-worker-"));
  vi.stubEnv("DRIVE_LOCAL_DIR", root);
  vi.stubEnv("FILE_WORKER_SECRET", "invented-worker-test-secret");
  try {
    await writeFile(join(root, "test.pdf"), "invented bytes");
    const body = JSON.stringify({ firm: "invented-firm", file: "test.pdf", name: "test.pdf", label: "Person", provider: "local", token: "", limit: 30, expires: Math.floor(Date.now() / 1000) + 60 });
    expect((await handle(new Request("http://worker/view/test.pdf", { method: "POST", body }))).status).toBe(403);
    const response = await handle(new Request("http://worker/view/test.pdf", { method: "POST", body, headers: { authorization: await signView(body, process.env.FILE_WORKER_SECRET!) } }));
    expect(response.status).toBe(200);
    const reader = readFrames(response.body!);
    const header = await reader.next();
    expect(JSON.parse(new TextDecoder().decode(header.value!)).pages).toHaveLength(2);
    expect(render.render).not.toHaveBeenCalled();
    expect((await reader.next()).value).toEqual(Uint8Array.of(1, 137, 80, 78, 71));
    expect(render.render).toHaveBeenCalledTimes(1);
    await reader.return(undefined);
    expect(render.render).toHaveBeenCalledTimes(1);
    expect(render.dispose).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
});

// The official GSTR-1 workbook used as a sales register: its sheets are formatted to row
// 1,004, and only filled rows count against the 1,000 row limit.
it("reads the official GSTR-1 workbook as a sales register, and still refuses one past the limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "sheet-worker-"));
  vi.stubEnv("DRIVE_LOCAL_DIR", root);
  vi.stubEnv("FILE_WORKER_SECRET", randomBytes(24).toString("base64url"));
  const read = async (file: string) => {
    const body = JSON.stringify({ firm: "invented-firm", file, name: file, label: "Read client file", provider: "local", token: "", limit: 30, expires: Math.floor(Date.now() / 1000) + 60, purpose: "sheet" });
    return handle(new Request(`http://worker/sheet/${file}`, { method: "POST", body, headers: { authorization: await signView(body, process.env.FILE_WORKER_SECRET!) } }));
  };
  try {
    const register = demoFiles("2026-09", "2026-10-28").find((file) => file.original.startsWith("sales register"))!;
    await writeFile(join(root, "register.xlsx"), register.bytes);
    const response = await read("register.xlsx");
    expect(response.status).toBe(200);
    const { rows, sheet, more } = await response.json();
    expect([sheet, ...more.map((other: { sheet: number }) => other.sheet)]).toEqual([2, 6]);
    expect(rows).toHaveLength(8);
    // A sale on row 1,003 is past the limit, after rows left blank.
    const cells = new Map([["xl/worksheets/sheet6.xml", new Map([["A1003", { value: "OE", number: false }]])]]);
    await writeFile(join(root, "long.xlsx"), writeWorkbook(readFileSync("reference/official/gstr1-v2.2/GSTR1_Excel_Workbook_Template_V2.2.xlsx"), cells));
    expect((await read("long.xlsx")).status).toBe(422);
  } finally { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
});
