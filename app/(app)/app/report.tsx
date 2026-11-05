"use client";
import { Camera, FileText, Paperclip, Square, Video, X } from "lucide-react";
import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { createPortal } from "react-dom";
import { reportFiles, reportKinds, type ReportKind } from "@/src/lib/report";
import { sendReport } from "./report-actions";
import { Sheet } from "./shell";

type Attached = { file: File; url: string };
const nothing = () => () => {};
const size = (bytes: number) => (bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`);

// Report a problem or idea, from Help or the search palette, for anyone in the firm. What they
// write stays here while the panel is closed, and while it steps aside for a screenshot or a
// recording, so the page itself is what is captured; a recording shows a small timer and Stop
// meanwhile. The browser asks which tab or window to share each time. done: it went.
export function ReportSheet({ open, close, done }: { open: boolean; close: () => void; done: () => void }) {
  const [kind, setKind] = useState<ReportKind | "">("");
  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");
  const [which, setWhich] = useState("");
  const [files, setFiles] = useState<Attached[]>([]);
  const [error, setError] = useState("");
  const [aside, setAside] = useState(false);
  const [seconds, setSeconds] = useState<number | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const [sending, start] = useTransition();
  // Chrome on a laptop shares the screen (2 with recording); elsewhere only choosing a file shows.
  const share = useSyncExternalStore(nothing, () => ("getDisplayMedia" in (navigator.mediaDevices ?? {}) ? ("MediaRecorder" in window && MediaRecorder.isTypeSupported("video/webm") ? 2 : 1) : 0), () => 0);
  const room = reportFiles.most - files.length;

  const add = (picked: File[]) => {
    const all = [...files.map((one) => one.file), ...picked];
    if (all.length > reportFiles.most || all.reduce((sum, file) => sum + file.size, 0) > reportFiles.bytes) return setError("Attach at most 3 files, 10 MB in all.");
    if (picked.some((file) => !reportFiles.accept.split(",").includes(file.type))) return setError("Attach a picture, a screen recording or a PDF.");
    setError("");
    setFiles((now) => [...now, ...picked.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  };
  const remove = (gone: Attached) => {
    URL.revokeObjectURL(gone.url);
    setFiles((now) => now.filter((one) => one !== gone));
  };
  // The browser's own question: which tab or window. No answer is not an error.
  const screen = async () => {
    setError("");
    try {
      return await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
    } catch {
      return null;
    }
  };
  const screenshot = async () => {
    const stream = await screen();
    if (!stream) return;
    setAside(true);
    try {
      const video = Object.assign(document.createElement("video"), { muted: true, srcObject: stream });
      await video.play();
      await new Promise((resolve) => setTimeout(resolve, 400));
      const canvas = Object.assign(document.createElement("canvas"), { width: video.videoWidth, height: video.videoHeight });
      canvas.getContext("2d")!.drawImage(video, 0, 0);
      canvas.toBlob((blob) => blob && add([new File([blob], "Screenshot.png", { type: "image/png" })]), "image/png");
    } catch {
      setError("The screenshot did not work. Try again, or choose a file.");
    } finally {
      stream.getTracks().forEach((track) => track.stop());
      setAside(false);
    }
  };
  const record = async () => {
    const stream = await screen();
    if (!stream) return;
    const parts: Blob[] = [];
    const media = new MediaRecorder(stream, { mimeType: "video/webm", videoBitsPerSecond: 600_000 });
    const began = Date.now();
    const tick = setInterval(() => {
      const now = Math.floor((Date.now() - began) / 1000);
      setSeconds(now);
      if (now >= reportFiles.seconds && media.state === "recording") media.stop();
    }, 250);
    media.ondataavailable = (event) => event.data.size && parts.push(event.data);
    media.onstop = () => {
      clearInterval(tick);
      stream.getTracks().forEach((track) => track.stop());
      recorder.current = null;
      setSeconds(null);
      add([new File(parts, "Screen recording.webm", { type: "video/webm" })]);
    };
    // Chrome's own Stop sharing ends it too.
    stream.getVideoTracks()[0].addEventListener("ended", () => media.state === "recording" && media.stop());
    recorder.current = media;
    setSeconds(0);
    media.start(1000);
  };
  const send = (event: React.FormEvent) => {
    event.preventDefault();
    const form = new FormData();
    for (const [name, value] of Object.entries({ kind, subject, details, which: kind === "old" ? which : "", path: location.pathname, screen: `${window.screen.width}x${window.screen.height}` })) form.set(name, value);
    for (const { file } of files) form.append("files", file);
    start(async () => {
      const { error } = await sendReport(form);
      if (error) return setError(error);
      files.forEach((one) => URL.revokeObjectURL(one.url));
      setKind("");
      setSubject("");
      setDetails("");
      setWhich("");
      setFiles([]);
      setError("");
      done();
    });
  };
  const clock = (value: number) => `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;

  return (
    <>
      <Sheet open={open && !aside && seconds === null} close={close} title="Report a problem or idea">
        <form className="report" onSubmit={send}>
          <p className="sheet-lede">Tell Orelu what is wrong or what you need. We read every report.</p>
          <fieldset className="fieldset">
            <legend>What is it</legend>
            <div className="report-kinds">
              {Object.entries(reportKinds).map(([value, label]) => (
                <label key={value} className="report-kind">
                  <input type="radio" name="kind" value={value} required checked={kind === value} onChange={() => setKind(value as ReportKind)} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          {kind === "old" && (
            <div className="report-field">
              <label htmlFor="report-which">Which form, rule, due date or file?</label>
              <input id="report-which" required maxLength={120} value={which} onChange={(event) => setWhich(event.target.value)} />
            </div>
          )}
          <div className="report-field">
            <label htmlFor="report-subject">Subject</label>
            <input id="report-subject" required maxLength={120} value={subject} onChange={(event) => setSubject(event.target.value)} />
          </div>
          <div className="report-field">
            <label htmlFor="report-details">Details, if you like</label>
            <textarea id="report-details" rows={4} maxLength={4000} value={details} onChange={(event) => setDetails(event.target.value)} placeholder="What you did, what you expected, and what happened" />
          </div>
          <fieldset className="fieldset">
            <legend>Attach, if it helps</legend>
            <div className="report-attach">
              {share > 0 && (
                <button type="button" className="b b-secondary" disabled={!room} onClick={screenshot}>
                  <Camera size={16} aria-hidden />
                  Take a screenshot
                </button>
              )}
              {share > 1 && (
                <button type="button" className="b b-secondary" disabled={!room} onClick={record}>
                  <Video size={16} aria-hidden />
                  Record the screen
                </button>
              )}
              <label className={`b b-secondary${room ? "" : " is-off"}`}>
                <Paperclip size={16} aria-hidden />
                Choose a file
                <input
                  className="sr-only"
                  type="file"
                  multiple
                  disabled={!room}
                  accept={reportFiles.accept}
                  onChange={(event) => {
                    add([...(event.target.files ?? [])]);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            <p className="hint">Up to 3 pictures, recordings of up to 1 minute, or PDFs, 10 MB in all.</p>
            {!!files.length && (
              <ul className="report-files" aria-label="Attached">
                {files.map((one) => (
                  <li key={one.url}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a picture still in the browser, nothing to optimise */}
                    {one.file.type.startsWith("image/") ? <img src={one.url} alt="" /> : one.file.type.startsWith("video/") ? <video src={one.url} controls muted /> : <FileText size={28} aria-hidden />}
                    <span className="grow">
                      {one.file.name}
                      <small>{size(one.file.size)}</small>
                    </span>
                    <button type="button" className="b b-ghost b-icon" aria-label={`Remove ${one.file.name}`} title="Remove" onClick={() => remove(one)}>
                      <X size={16} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
          <p className="report-note">
            Pictures and recordings can show client details, such as PANs or names. They go only to Orelu support and are used only to fix and improve InboxCA. The page you are on, your role, your browser and the time go with it.
          </p>
          {error && <p className="alert" role="alert">{error}</p>}
          <button type="submit" className="b b-primary report-send" disabled={sending} aria-busy={sending}>
            {sending ? "Sending" : "Send to Orelu"}
          </button>
        </form>
      </Sheet>
      {seconds !== null &&
        createPortal(
          <div className="report-rec" role="status">
            <span className="report-dot" aria-hidden />
            Recording {clock(seconds)} of 1:00
            <button type="button" className="b b-secondary b-small" onClick={() => recorder.current?.stop()}>
              <Square size={14} aria-hidden />
              Stop
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
