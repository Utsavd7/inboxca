"use client";
import { useEffect, useState } from "react";
import { logCapture } from "@/app/(app)/actions";

// The server draws the file and the viewer's identity into the same image.
export function FileViewer({ id, hideInactive = false }: { id: string; hideInactive?: boolean }) {
  const [pages, setPages] = useState<{ first: string; count: number; limited: boolean; width: number; height: number }>();
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
    const controller = new AbortController();
    let url: string | undefined;
    (async () => {
      const response = await fetch(`/app/files/${id}/pages/1`, { signal: controller.signal });
      if (!response.ok) throw new Error("file");
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      setPages({ first: url, count: Number(response.headers.get("X-InboxCA-Pages")), limited: response.headers.get("X-InboxCA-Limited") === "true", width: Number(response.headers.get("X-InboxCA-Width")), height: Number(response.headers.get("X-InboxCA-Height")) });
      setState("shown");
    })().catch(() => !controller.signal.aborted && setState("failed"));
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);

  return (
    <div className="viewer">
      {state === "loading" && <p className="hint">Opening the file from your firm&apos;s drive.</p>}
      {state === "failed" && (
        <p className="alert" role="alert">
          The file could not be opened. It may have been moved or removed in the drive.
        </p>
      )}
      {blank && <p className="hint viewer-blank">The document is hidden for a moment.</p>}
      {pages?.limited && <p className="hint">Only the first 30 pages, or the first 1,000 rows and 12 columns of the first sheet, are shown here.</p>}
      <div className={`viewer-pages${blank ? " is-blank" : ""}`} onContextMenu={(event) => event.preventDefault()} onDragStart={(event) => event.preventDefault()} onCopy={(event) => event.preventDefault()}>
        {pages && Array.from({ length: pages.count }, (_, index) => (
          // The protected image needs this person's session, so it must bypass the image cache.
          // eslint-disable-next-line @next/next/no-img-element
          <img key={index} src={index === 0 ? pages.first : `/app/files/${id}/pages/${index + 1}`} alt={`Page ${index + 1}`} width={pages.width} height={pages.height} loading={index === 0 ? "eager" : "lazy"} draggable={false} onError={() => setState("failed")} />
        ))}
      </div>
    </div>
  );
}
