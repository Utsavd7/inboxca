"use client";
import { useEffect, useState } from "react";
import { readFrames, viewLimits, type ViewHeader } from "@/src/lib/file-worker";
import { logCapture } from "@/app/(app)/actions";

// The file worker sends only stamped pages. Each appears as soon as its frame arrives. A
// thumbnail asks for the first page only, which is not logged as a view.
export function FileViewer({ id, hideInactive = false, page: shownPage, sheet = 1, thumb = false }: { id: string; hideInactive?: boolean; page?: number; sheet?: number; thumb?: boolean }) {
  const [pages, setPages] = useState<{ url: string; width: number; height: number }[]>([]);
  const [limited, setLimited] = useState(false);
  const [state, setState] = useState<"loading" | "shown" | "failed" | "nodrive" | "large">("loading");
  const [blank, setBlank] = useState(false);

  // Capture deterrents (5.17.2): a screenshot key blanks the pages for a few seconds, tries to
  // clear the clipboard and is logged; with the firm's setting, pages hide while InboxCA is
  // not the active window. None of this can stop a photo of the screen; the watermark traces it.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Print Screen is seen on key up (some systems send no key down); the Mac's keys on key down.
    const capture = (event: KeyboardEvent) => {
      const mac = event.type === "keydown" && event.metaKey && event.shiftKey && ["3", "4", "5"].includes(event.key);
      if (!(event.type === "keyup" && event.key === "PrintScreen") && !mac) return;
      setBlank(true);
      clearTimeout(timer);
      timer = setTimeout(() => setBlank(false), 4000);
      navigator.clipboard?.writeText("").catch(() => {});
      void logCapture(id);
    };
    const away = () => hideInactive && setBlank(true);
    const back = () => hideInactive && setBlank(false);
    window.addEventListener("keydown", capture);
    window.addEventListener("keyup", capture);
    window.addEventListener("blur", away);
    window.addEventListener("focus", back);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", capture);
      window.removeEventListener("keyup", capture);
      window.removeEventListener("blur", away);
      window.removeEventListener("focus", back);
    };
  }, [id, hideInactive]);

  useEffect(() => {
    const controller = new AbortController();
    const urls: string[] = [];
    (async () => {
      const response = await fetch(`/app/files/${id}/stream${thumb ? "?thumb=1" : sheet===1 ? "" : `?sheet=${sheet}`}`, { signal: controller.signal });
      // A refusal's body is let go at once, or the browser keeps the request open.
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        // The stream route says why: no drive linked (409) or a file too large to show (413).
        if (response.status === 409 || response.status === 413) return setState(response.status === 409 ? "nodrive" : "large");
        throw new Error("file");
      }
      let header: ViewHeader | undefined, number = 0;
      for await (const frame of readFrames(response.body)) {
        if (controller.signal.aborted) return;
        if (!header) {
          if (frame.length > 16_384) throw new Error("header");
          header = JSON.parse(new TextDecoder().decode(frame)) as ViewHeader;
          if (!Array.isArray(header.pages) || !header.pages.length || header.pages.length > viewLimits.pages || header.pages.some(({ width, height }) => !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > viewLimits.pixels)) throw new Error("pages");
          setLimited(header.limited);
          continue;
        }
        const size = header.pages[number++];
        if (!size || ![1, 2].includes(frame[0])) throw new Error("image");
        const url = URL.createObjectURL(new Blob([frame.slice(1)], { type: frame[0] === 1 ? "image/png" : "image/jpeg" }));
        urls.push(url);
        setPages((previous) => [...previous, { url, ...size }]);
        setState("shown");
      }
      if (!header || number !== header.pages.length) throw new Error("Incomplete file");
    })().catch(() => !controller.signal.aborted && setState("failed"));
    return () => {
      controller.abort();
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [id, sheet, thumb]);

  return (
    <div className="viewer">
      {state === "loading" && <p className="hint">Opening the file from your firm&apos;s drive.</p>}
      {state === "failed" && (
        <p className="alert" role="alert">
          The file could not be opened. It may have been moved or removed in the drive.
        </p>
      )}
      {state === "nodrive" && <p className="hint">The firm&apos;s drive is not linked yet, so papers cannot be shown. The owner links it in Settings, Email and drive.</p>}
      {state === "large" && <p className="hint">This file is too large to show here.</p>}
      {blank && <p className="hint viewer-blank">The document is hidden for a moment.</p>}
      {limited && !thumb && <p className="hint">Only the first 30 pages, or the first 1,000 rows and 26 columns of the selected sheet, are shown here.</p>}
      <div className={`viewer-pages${blank ? " is-blank" : ""}`} onContextMenu={(event) => event.preventDefault()} onDragStart={(event) => event.preventDefault()} onCopy={(event) => event.preventDefault()}>
        {pages.map((page, index) => (
          // eslint-disable-next-line @next/next/no-img-element
          (shownPage===undefined || shownPage===index+1) && <img key={page.url} src={page.url} alt={`Page ${index + 1}`} width={page.width} height={page.height} draggable={false} onError={() => setState("failed")} />
        ))}
      </div>
    </div>
  );
}
