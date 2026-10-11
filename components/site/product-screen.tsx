"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useAnimate } from "motion/react-mini";
import {
  Check,
  ChevronRight,
  FileText,
  Folder,
  Inbox,
  LockKeyhole,
  Mail,
  Paperclip,
  Send,
  ShieldCheck,
} from "lucide-react";
import { Logo } from "./logo";

export function PreviewWindow({
  title,
  children,
  detail,
}: {
  title: string;
  children: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="preview-window">
      <div className="preview-chrome">
        <Logo />
        <span className="mono">10 Oct 2026</span>
      </div>
      <div className="preview-title">
        <span>{title}</span>
        {detail || <span className="mono">Sample client</span>}
      </div>
      {children}
    </div>
  );
}
const papers = ["Sales register", "Purchase bills", "Bank statement"];
const received = [true, false, true];
function ScreenContent({ step }: { step: number }) {
  const [approved, setApproved] = useState(false);
  if (step === 0)
    return (
      <>
        <div className="preview-mail">
          <div className="sender-icon">
            <Mail size={20} aria-hidden />
          </div>
          <div>
            <strong>Sample client</strong>
            <span className="mono">Client email · 09:12</span>
          </div>
        </div>
        <h4>Purchase bills for September</h4>
        <p className="preview-text">Please find the purchase bills attached.</p>
        <div className="paper-file">
          <FileText aria-hidden />
          <span>
            Purchase bills.pdf<small className="mono">Attachment</small>
          </span>
        </div>
        <div className="route-line">
          <Inbox size={17} aria-hidden />
          <span>Client email</span>
          <ChevronRight size={16} aria-hidden />
          <Folder size={17} aria-hidden />
          <span>Client folder</span>
        </div>
        <div className="preview-note">
          <Check size={17} aria-hidden />
          Read and sorted
        </div>
      </>
    );
  if (step === 1)
    return (
      <>
        <div className="folder-path mono">
          <Folder size={16} aria-hidden />
          Clients
          <ChevronRight size={14} aria-hidden />
          Sample client
        </div>
        <div className="paper-table">
          <div className="paper-table-head mono">
            <span>Paper</span>
            <span>Status</span>
          </div>
          {papers.map((paper) => (
            <div key={paper}>
              <span>
                <FileText size={18} aria-hidden />
                {paper}
              </span>
              <span className="status-done mono">
                <Check size={14} aria-hidden />
                Saved
              </span>
            </div>
          ))}
        </div>
        <div className="drive-note">
          <Folder size={24} aria-hidden />
          <div>
            <strong>Your own drive</strong>
            <p>OneDrive or Dropbox</p>
          </div>
          <ShieldCheck size={20} aria-hidden />
        </div>
      </>
    );
  if (step === 2)
    return (
      <>
        <div className="request-note">
          <Mail size={18} aria-hidden />
          <p>Please send last year’s ITR acknowledgement.</p>
        </div>
        <div className="reply-card">
          <span className="mono">From your firm’s email</span>
          <p>Here is your ITR acknowledgement, as a password protected PDF.</p>
          <div className="paper-file">
            <Paperclip size={18} aria-hidden />
            <span>ITR acknowledgement.pdf</span>
          </div>
        </div>
        <div className="reply-rules">
          <div>
            <Send size={18} aria-hidden />
            <strong>Routine papers</strong>
            <span className="status-done mono">Reply sent</span>
          </div>
          <div>
            <LockKeyhole size={18} aria-hidden />
            <strong>Private papers</strong>
            <span className="status-wait mono">Waits for your OK</span>
          </div>
        </div>
      </>
    );
  if (step === 3)
    return (
      <>
        <div className="checklist-title">
          <strong>GST papers for September</strong>
          <span className="mono">Due 20 Oct 2026</span>
        </div>
        <div className="paper-table checklist">
          {papers.map((paper, i) => (
            <div key={paper}>
              <span>
                {received[i] ? (
                  <Check size={18} className="done-icon" aria-hidden />
                ) : (
                  <span className="empty-check" />
                )}
                {paper}
              </span>
              <span
                className={`mono ${received[i] ? "status-done" : "status-wait"}`}
              >
                {received[i] ? "Received" : "Missing"}
              </span>
            </div>
          ))}
        </div>
        <div className="reminder-note">
          <Mail size={18} aria-hidden />
          <div>
            <span className="mono">Reminder from your firm</span>
            <p>
              We have your sales bills. Only the purchase bills are still
              needed.
            </p>
          </div>
        </div>
      </>
    );
  return (
    <>
      <div className="form-summary">
        <FileText size={26} aria-hidden />
        <div>
          <strong><span className="mono">GSTR-1</span> · September</strong>
          <span className="mono">{approved ? "Approved in this illustration" : "Ready for your team to check"}</span>
        </div>
      </div>
      <div className="review-path">
        <div>
          <Check size={17} aria-hidden />
          <span>Numbers read from your files</span>
        </div>
        <div>
          <Check size={17} aria-hidden />
          <span>Form prepared</span>
        </div>
        <div>
          {approved ? <Check size={17} aria-hidden /> : <span className="empty-check" />}
          <span>Your team checks and approves</span>
        </div>
      </div>
      <div className="approval-note">
        <ShieldCheck size={20} aria-hidden />
        <p>Your team files with its own OTP or signature.</p>
      </div>
      <button
        aria-pressed={approved}
        className={`preview-approve ${approved ? "approved" : ""}`}
        onClick={() => setApproved(!approved)}
      >
        <Check size={17} aria-hidden />
        {approved
          ? "Approved in this illustration"
          : "Try the approval illustration"}
      </button>
    </>
  );
}
const titles = [
  "Client email",
  "Client folder",
  "Reply to a client",
  "Missing papers",
  "Forms for approval",
];
export function ProductScreen({
  step,
  animate = true,
}: {
  step: number;
  animate?: boolean;
}) {
  const [scope, run] = useAnimate<HTMLDivElement>();
  useEffect(() => {
    const pane = scope.current;
    if (
      !animate ||
      !pane ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        run(
          pane,
          {
            opacity: [0.65, 1],
            transform: ["translateY(10px)", "translateY(0px)"],
          },
          { duration: 0.35, ease: [0.23, 1, 0.32, 1] },
        );
        pane
          .querySelectorAll(":scope > *")
          .forEach((el, i) =>
            run(
              el,
              {
                opacity: [0, 1],
                transform: ["translateY(8px)", "translateY(0px)"],
              },
              { duration: 0.35, delay: i * 0.055, ease: [0.23, 1, 0.32, 1] },
            ),
          );
        observer.disconnect();
      },
      { threshold: 0.2 },
    );
    observer.observe(pane);
    return () => observer.disconnect();
  }, [step, animate, scope, run]);
  return (
    <figure className="product-figure">
      <PreviewWindow title={titles[step]}>
        <div className="preview-body" ref={scope} key={step}>
          <ScreenContent step={step} />
        </div>
      </PreviewWindow>
      <figcaption className="sample mono">
        Illustration · sample data
      </figcaption>
    </figure>
  );
}
