import { afterEach, expect, it, vi } from "vitest";
import { intakeLimits } from "@/src/lib/file-worker";
import { fetchShared, sharedLinks } from "@/src/lib/share-link";

afterEach(() => vi.restoreAllMocks());

it("fetches only a file link on Google Drive, Dropbox or OneDrive; folders, docs and other sites never", () => {
  const text = [
    "Here https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing and",
    "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing,",
    "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit",
    "https://www.dropbox.com/scl/fi/abc123/bank.pdf?rlkey=xyz&dl=0 https://www.dropbox.com/scl/fo/abc123/h?dl=0",
    "https://1drv.ms/b/s!AbCdEf https://1drv.ms/f/s!AbCdEf https://contoso-my.sharepoint.com/:b:/g/personal/x/EaBc",
    "http://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view https://evil.test/drive.google.com/file/d/1AbCdEfGhIjKlMnOp",
    "https://drive.google.com.evil.test/file/d/1AbCdEfGhIjKlMnOp https://169.254.169.254/latest/meta-data https://localhost/x",
  ].join(" ");
  expect(sharedLinks(text)).toEqual([
    { url: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing", fetch: "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp" },
    { url: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing", fetch: null },
    { url: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit", fetch: null },
    { url: "https://www.dropbox.com/scl/fi/abc123/bank.pdf?rlkey=xyz&dl=0", fetch: "https://www.dropbox.com/scl/fi/abc123/bank.pdf?rlkey=xyz&dl=1" },
    { url: "https://www.dropbox.com/scl/fo/abc123/h?dl=0", fetch: null },
  ]);
  expect(sharedLinks("https://1drv.ms/b/s!AbCdEf https://1drv.ms/f/s!AbCdEf https://contoso-my.sharepoint.com/:b:/g/personal/x/EaBc")).toEqual([
    { url: "https://1drv.ms/b/s!AbCdEf", fetch: `https://api.onedrive.com/v1.0/shares/u!${Buffer.from("https://1drv.ms/b/s!AbCdEf").toString("base64url")}/root/content` },
    { url: "https://1drv.ms/f/s!AbCdEf", fetch: null },
    { url: "https://contoso-my.sharepoint.com/:b:/g/personal/x/EaBc", fetch: null },
  ]);
});

// The fetch never leaves the allowed hosts: a redirect elsewhere, http, a sign in page or a
// file over the limit all end without a file, and the forbidden address is never asked for.
it("follows redirects only inside the allowed hosts and takes no sign in page or oversized file", async () => {
  const asked: string[] = [];
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    asked.push(url);
    if (url.startsWith("https://drive.google.com/uc")) return new Response(null, { status: 302, headers: { location: "https://drive.usercontent.google.com/download?id=1&export=download" } });
    if (url.startsWith("https://drive.usercontent.google.com/")) return new Response("%PDF-1.4 invented", { status: 200, headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename=\"bank.pdf\"" } });
    if (url.includes("to-evil")) return new Response(null, { status: 302, headers: { location: "https://evil.test/steal" } });
    if (url.includes("to-http")) return new Response(null, { status: 302, headers: { location: "http://drive.google.com/plain" } });
    if (url.includes("to-meta")) return new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } });
    if (url.includes("signin")) return new Response("<html>Sign in</html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    if (url.includes("private")) return new Response("no", { status: 403 });
    if (url.includes("huge")) return new Response("x", { status: 200, headers: { "content-type": "application/pdf", "content-length": String(intakeLimits.bytes + 1) } });
    if (url.includes("stream")) return new Response(new ReadableStream({ start(controller) { for (let n = 0; n < 6; n++) controller.enqueue(new Uint8Array(10 * 1024 * 1024)); controller.close(); } }), { status: 200, headers: { "content-type": "application/pdf" } });
    throw new Error(`unexpected ${url}`);
  });
  const got = await fetchShared("https://drive.google.com/uc?export=download&id=1");
  expect(typeof got === "object" && got.name).toBe("bank.pdf");
  expect(await fetchShared("https://www.dropbox.com/scl/fi/to-evil/x.pdf?dl=1")).toBe("private");
  expect(await fetchShared("https://www.dropbox.com/scl/fi/to-http/x.pdf?dl=1")).toBe("private");
  expect(await fetchShared("https://www.dropbox.com/scl/fi/to-meta/x.pdf?dl=1")).toBe("private");
  expect(await fetchShared("https://www.dropbox.com/scl/fi/signin/x.pdf?dl=1")).toBe("private");
  expect(await fetchShared("https://www.dropbox.com/scl/fi/private/x.pdf?dl=1")).toBe("private");
  expect(await fetchShared("https://www.dropbox.com/scl/fi/huge/x.pdf?dl=1")).toBe("large");
  expect(await fetchShared("https://www.dropbox.com/scl/fi/stream/x.pdf?dl=1")).toBe("large");
  expect(await fetchShared("https://evil.test/file.pdf")).toBe("private");
  expect(await fetchShared("http://drive.google.com/uc?export=download&id=1")).toBe("private");
  expect(asked.some((url) => /evil\.test|169\.254|^http:/.test(url))).toBe(false);
  expect(fetcher).toHaveBeenCalled();
});
