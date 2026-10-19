"use client";
import { useEffect, useRef, useState } from "react";
import { logCapture } from "@/app/(app)/actions";

// Draws a file page by page onto canvases, each with the viewer's name and the time across
// it, and offers no download (D18). It discourages copying; it cannot stop a photo of the
// screen, which is why every page carries who looked and when.
export function FileViewer({ id, kind, watermark, hideInactive = false }: { id: string; kind: "pdf" | "image"; watermark: string; hideInactive?: boolean }) {
  const pages = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "shown" | "failed">("loading");
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
    let stopped = false;
    const holder = pages.current!;
    const width = Math.min(holder.parentElement!.clientWidth, 1000);
    const mark = (canvas: HTMLCanvasElement) => {
      const context = canvas.getContext("2d")!;
      context.save();
      context.fillStyle = "rgba(24, 32, 47, 0.13)";
      const size = Math.round(canvas.width / 48);
      context.font = `600 ${size}px system-ui, sans-serif`;
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(-Math.PI / 6);
      const across = context.measureText(watermark).width + size * 4;
      const reach = Math.hypot(canvas.width, canvas.height);
      for (let y = -reach; y < reach; y += size * 7)
        for (let x = -reach + ((y / (size * 7)) % 2) * (across / 2); x < reach; x += across) context.fillText(watermark, x, y);
      context.restore();
      canvas.addEventListener("contextmenu", (event) => event.preventDefault());
      canvas.addEventListener("dragstart", (event) => event.preventDefault());
      holder.append(canvas);
    };
    (async () => {
      const response = await fetch(`/app/files/${id}?view=1`, { headers: { "x-inboxca-viewer": "1" } });
      if (!response.ok) throw new Error("file");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (kind === "image") {
        const image = await createImageBitmap(new Blob([bytes]));
        const canvas = Object.assign(document.createElement("canvas"), { width: image.width, height: image.height });
        canvas.getContext("2d")!.drawImage(image, 0, 0);
        if (!stopped) mark(canvas);
      } else {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const pdf = await pdfjs.getDocument({ data: bytes }).promise;
        for (let number = 1; number <= pdf.numPages && !stopped; number++) {
          const page = await pdf.getPage(number);
          const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * window.devicePixelRatio });
          const canvas = Object.assign(document.createElement("canvas"), { width: viewport.width, height: viewport.height });
          await page.render({ canvas, viewport }).promise;
          if (!stopped) mark(canvas);
        }
      }
      if (!stopped) setState("shown");
    })().catch(() => !stopped && setState("failed"));
    return () => {
      stopped = true;
      holder.replaceChildren();
    };
  }, [id, kind, watermark]);

  return (
    <div className="viewer">
      {state === "loading" && <p className="hint">Opening the file from your firm&apos;s drive.</p>}
      {state === "failed" && (
        <p className="alert" role="alert">
          The file could not be opened. It may have been moved or removed in the drive.
        </p>
      )}
      {blank && <p className="hint viewer-blank">The document is hidden for a moment.</p>}
      <div ref={pages} className={`viewer-pages${blank ? " is-blank" : ""}`} />
    </div>
  );
}
