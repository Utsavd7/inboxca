import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { signView, readFrames } from "@/src/lib/file-worker";

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
