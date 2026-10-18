"use client";
import { useEffect, useRef, useState } from "react";

// Draws a file page by page onto canvases, each with the viewer's name and the time across
// it, and offers no download (D18). It discourages copying; it cannot stop a photo of the
// screen, which is why every page carries who looked and when.
export function FileViewer({ id, kind, watermark }: { id: string; kind: "pdf" | "image"; watermark: string }) {
  const pages = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "shown" | "failed">("loading");

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
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
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
      <div ref={pages} className="viewer-pages" />
    </div>
  );
}
