"use client";
import { useEffect, useRef, useState } from "react";
import { readFrames, viewLimits, type ViewHeader, type ViewMark } from "@/src/lib/file-worker";
import { logCapture, savePassword } from "@/app/(app)/actions";

// The file worker sends only stamped pages. Each appears as soon as its frame arrives. A
// thumbnail asks for the first page only, which is not logged as a view. With marks (a set of
// figures) the worker also says where each of its figures from this paper sits, and mark (one
// of them) is boxed on the page shown; onPages hands the stamped pages and spots to a peek.
export type ViewerPages = { pages: { url: string; width: number; height: number }[]; marks: ViewMark[]; blank: boolean };
// Check on the form draws the page again after each check (a new address remounts it): the last
// paper it showed stays at hand, and half a minute after it closes, so the same paper is not
// opened, or logged, again.
type Kept = { key: string; pages: ViewerPages["pages"]; marks: ViewMark[]; limited: boolean; live: boolean; timer?: ReturnType<typeof setTimeout> };
let kept: Kept | null = null;
const drop = (entry: Kept) => {
  clearTimeout(entry.timer);
  if (entry.live) return;
  entry.pages.forEach((page) => URL.revokeObjectURL(page.url));
  if (kept === entry) kept = null;
};
export function FileViewer({ id, hideInactive = false, page: shownPage, sheet = 1, thumb = false, marks: figures, mark, onPages }: { id: string; hideInactive?: boolean; page?: number; sheet?: number; thumb?: boolean; marks?: string; mark?: string; onPages?: (view: ViewerPages) => void }) {
  const key = figures && !thumb ? `${id}|${sheet}|${figures}` : "";
  const [reused] = useState(() => (key && kept?.key === key ? kept : null));
  const [pages, setPages] = useState<{ url: string; width: number; height: number }[]>(reused?.pages ?? []);
  const [spots, setSpots] = useState<ViewMark[]>(reused?.marks ?? []);
  const scroller = useRef<HTMLDivElement>(null);
  const [limited, setLimited] = useState(reused?.limited ?? false);
  const [state, setState] = useState<"loading" | "shown" | "failed" | "nodrive" | "large" | "locked" | "wrong">(reused ? "shown" : "loading");
  const [blank, setBlank] = useState(false);
  const [opening, setOpening] = useState(0);

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
    const shown: Kept = reused && kept === reused && !opening ? kept : { key, pages: [], marks: [], limited: false, live: true };
    let done = shown === reused;
    shown.live = true;
    clearTimeout(shown.timer);
    if (!done) (async () => {
      const query = new URLSearchParams(thumb ? { thumb: "1" } : { ...(sheet !== 1 && { sheet: String(sheet) }), ...(figures && { marks: figures }) });
      const response = await fetch(`/app/files/${id}/stream${query.size ? `?${query}` : ""}`, { signal: controller.signal });
      // A PDF with a password: ask for it, or say the saved one did not open it.
      if (response.status === 423) { const said = await response.text(); if (!controller.signal.aborted) setState(said === "wrong" ? "wrong" : "locked"); return; }
      // A refusal's body is let go at once, or the browser keeps the request open.
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        // The stream route says why: no drive connected (409) or a file too large to show (413).
        if (response.status === 409 || response.status === 413) return setState(response.status === 409 ? "nodrive" : "large");
        throw new Error("file");
      }
      let header: ViewHeader | undefined, number = 0;
      for await (const frame of readFrames(response.body)) {
        if (controller.signal.aborted) return;
        if (!header) {
          if (frame.length > 65_536) throw new Error("header");
          header = JSON.parse(new TextDecoder().decode(frame)) as ViewHeader;
          if (!Array.isArray(header.pages) || !header.pages.length || header.pages.length > viewLimits.pages || header.pages.some(({ width, height }) => !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > viewLimits.pixels)) throw new Error("pages");
          setLimited(header.limited);
          const part = (value: unknown) => typeof value === "number" && value >= 0 && value <= 1;
          shown.limited = header.limited;
          shown.marks = Array.isArray(header.marks) ? header.marks.filter((one) => typeof one?.id === "string" && Number.isInteger(one.page) && [one.x, one.y, one.width, one.height].every(part)) : [];
          setSpots(shown.marks);
          continue;
        }
        const size = header.pages[number++];
        if (!size || ![1, 2].includes(frame[0])) throw new Error("image");
        const url = URL.createObjectURL(new Blob([frame.slice(1)], { type: frame[0] === 1 ? "image/png" : "image/jpeg" }));
        shown.pages.push({ url, ...size });
        setPages((previous) => [...previous, { url, ...size }]);
        setState("shown");
      }
      if (!header || number !== header.pages.length) throw new Error("Incomplete file");
      done = true;
      if (!key) return;
      const before = kept;
      kept = shown;
      if (before && before !== shown) drop(before);
    })().catch(() => !controller.signal.aborted && setState("failed"));
    return () => {
      controller.abort();
      shown.live = false;
      if (key && done && kept === shown) shown.timer = setTimeout(() => drop(shown), 30_000);
      else shown.pages.forEach((page) => URL.revokeObjectURL(page.url));
    };
  }, [id, sheet, thumb, opening, figures, key, reused]);

  useEffect(() => onPages?.({ pages, marks: spots, blank }), [pages, spots, blank, onPages]);
  // The marked figure is brought to the middle of the pane: at once when the page first shows,
  // then smoothly from one figure to the next unless motion is reduced.
  const spot = mark ? spots.find((one) => one.id === mark && one.page === shownPage) : undefined;
  const placed = useRef("");
  useEffect(() => {
    const box = scroller.current, image = box?.querySelector("img");
    if (!box || !image) return;
    // A page has its size once its picture is read.
    const place = () => {
      const outer = box.getBoundingClientRect(), page = image.getBoundingClientRect(), smooth = placed.current === image.src && !matchMedia("(prefers-reduced-motion: reduce)").matches;
      placed.current = image.src;
      if (!spot) return box.scrollTo({ top: 0, left: 0 });
      box.scrollTo({ top: box.scrollTop + page.top - outer.top + (spot.y + spot.height / 2) * page.height - outer.height / 2, left: box.scrollLeft + page.left - outer.left + (spot.x + spot.width / 2) * page.width - outer.width / 2, behavior: smooth ? "smooth" : "instant" });
    };
    if (image.complete && image.naturalWidth) place();
    else image.addEventListener("load", place, { once: true });
    return () => image.removeEventListener("load", place);
  }, [spot, shownPage, pages.length]);

  return (
    <div className="viewer">
      {state === "loading" && <p className="hint">Opening the file from your firm&apos;s drive.</p>}
      {state === "failed" && (
        <p className="alert" role="alert">
          The file could not be opened. It may have been moved or removed in the drive.
        </p>
      )}
      {state === "nodrive" && <p className="hint">The firm&apos;s drive is not connected yet, so papers cannot be shown. The owner can connect it in Settings, under Email and drive.</p>}
      {state === "large" && <p className="hint">This file is too large to show here.</p>}
      {(state === "locked" || state === "wrong") && (thumb ? <p className="hint">This PDF has a password.</p> : (
        <form className="form-row" action={async (form) => { if (await savePassword(form) === "saved") { setState("loading"); setOpening((n) => n + 1); } }}>
          <input type="hidden" name="document" value={id} />
          <div>
            <label htmlFor="viewer-password">{state === "wrong" ? "That password did not open it. Type it again." : "This PDF has a password. Type it to open the file."}</label>
            <input id="viewer-password" name="password" type="password" autoComplete="off" required maxLength={200} />
          </div>
          <button className="b b-primary">Open</button>
          <p className="hint">InboxCA keeps it encrypted, so your team can open this file too.</p>
        </form>
      ))}
      {blank && <p className="hint viewer-blank">The pages are hidden. They show again in a few seconds, or when you come back to this window.</p>}
      {limited && !thumb && <p className="hint">Only the first 30 pages, or the first 1,000 rows and 26 columns of the selected sheet, are shown here.</p>}
      <div ref={scroller} className={`viewer-pages${blank ? " is-blank" : ""}`} onContextMenu={(event) => event.preventDefault()} onDragStart={(event) => event.preventDefault()} onCopy={(event) => event.preventDefault()}>
        {pages.map((page, index) => {
          if (shownPage !== undefined && shownPage !== index + 1) return null;
          // eslint-disable-next-line @next/next/no-img-element
          const image = <img key={page.url} src={page.url} alt={`Page ${index + 1}`} width={page.width} height={page.height} draggable={false} onError={() => setState("failed")} />;
          return figures ? <span key={page.url} className="viewer-page">{image}{spot && <i className="viewer-mark" style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%`, width: `${spot.width * 100}%`, height: `${spot.height * 100}%` }} aria-hidden />}</span> : image;
        })}
      </div>
    </div>
  );
}
