"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, FileText, Folder, KeyRound, Laptop } from "lucide-react";

const ease = [0.23, 1, 0.32, 1] as const;

// The pointer lights the card it is over. Fine pointers only (see the CSS).
function spotlight(event: React.PointerEvent<HTMLElement>) {
  const card = (event.target as Element).closest<HTMLElement>(".cell");
  if (!card) return;
  const box = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${event.clientX - box.left}px`);
  card.style.setProperty("--my", `${event.clientY - box.top}px`);
}

function DriveCell() {
  const [drive, setDrive] = useState<"OneDrive" | "Dropbox">("OneDrive");
  return (
    <li className="cell cell-wide">
      <div className="cell-copy">
        <h3>Your files stay in your own drive</h3>
        <p>
          Every paper is saved in your firm&apos;s OneDrive or Dropbox, in
          folders you can open any time. Your old files stay where they are,
          and a change you make there is picked up within minutes.
        </p>
        <div className="segment" role="group" aria-label="Choose a drive">
          {(["OneDrive", "Dropbox"] as const).map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={drive === name}
              onClick={() => setDrive(name)}
            >
              {drive === name && (
                <motion.span
                  layoutId="drive-pick"
                  className="segment-pick"
                  transition={{ type: "spring", duration: 0.55, bounce: 0.16 }}
                />
              )}
              <span>{name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="widget tree-dark" aria-hidden>
        <div className="tree-row">
          <Folder size={16} />
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={drive}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.26, ease }}
            >
              Your {drive}
            </motion.span>
          </AnimatePresence>
        </div>
        <div className="tree-row" style={{ paddingLeft: 20 }}>
          <Folder size={16} />
          <span className="num">FY 2026-27</span>
        </div>
        <div className="tree-row" style={{ paddingLeft: 40 }}>
          <Folder size={16} />
          <span>Patel Textiles</span>
        </div>
        <div className="tree-row" style={{ paddingLeft: 60 }}>
          <Folder size={16} />
          <span>GST</span>
        </div>
        <div className="tree-row tree-leaf" style={{ paddingLeft: 80 }}>
          <FileText size={16} />
          <span className="num">Patel Textiles - Purchase bills - Sep 2026.pdf</span>
        </div>
      </div>
    </li>
  );
}

function OfficeCell() {
  const [on, setOn] = useState(false);
  return (
    <li className="cell">
      <div className="cell-copy">
        <h3>Office only, with one switch</h3>
        <p>Keep staff to the PCs you approved, in your office, in your hours.</p>
      </div>
      <div className="widget">
        <div className="switch-row">
          <span id="office-switch">Staff can use InboxCA only in the office</span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-labelledby="office-switch"
            className="switch"
            onClick={() => setOn(!on)}
          >
            <span className="switch-thumb" />
          </button>
        </div>
        <ul className="rules">
          {["Approved office PCs", "Office internet", "Office hours"].map(
            (rule) => (
              <li key={rule} className={on ? "is-on" : ""}>
                <span className="rule-dot">
                  <Check size={12} strokeWidth={3.5} aria-hidden />
                </span>
                {rule}
              </li>
            ),
          )}
        </ul>
      </div>
    </li>
  );
}

function ApproveCell() {
  const [sent, setSent] = useState(false);
  return (
    <li className="cell">
      <div className="cell-copy">
        <h3>Private papers wait for your OK</h3>
        <p>
          Routine papers go to the client by themselves. Private ones wait for
          one click.
        </p>
      </div>
      <div className="widget">
        <div className="paper-row">
          <FileText size={18} aria-hidden />
          <span>
            <strong>Audit report</strong>
            <small>
              For D&apos;Souza Exports, <span className="num">FY 2025-26</span>
            </small>
          </span>
        </div>
        <button
          type="button"
          className={`send ${sent ? "is-sent" : ""}`}
          onClick={() => setSent(!sent)}
          aria-pressed={sent}
        >
          {sent && <Check size={16} strokeWidth={3} aria-hidden />}
          {sent ? "Sent to the client" : "OK, send it"}
        </button>
      </div>
    </li>
  );
}

export function Control() {
  return (
    <ul className="bento" onPointerMove={spotlight}>
      <DriveCell />
      <li className="cell">
        <div className="cell-copy">
          <h3>No portal passwords</h3>
          <p>
            InboxCA never logs in to the GST or income tax portal. Your team
            files every return itself.
          </p>
        </div>
        <div className="widget never" aria-hidden>
          {["Portal password", "OTP"].map((secret) => (
            <div key={secret} className="never-row">
              <KeyRound size={16} />
              <span>{secret}</span>
              <span className="never-tag">Never asked</span>
            </div>
          ))}
        </div>
      </li>
      <OfficeCell />
      <ApproveCell />
      <li className="cell">
        <div className="cell-copy">
          <h3>Your login, on your computers only</h3>
          <p>
            A new computer waits for your OK. Lost a laptop? Remove it and it is
            signed out.
          </p>
        </div>
        <div className="widget never" aria-hidden>
          {[
            ["This laptop", "Approved"],
            ["New computer", "Waits for you"],
          ].map(([name, state], index) => (
            <div key={name} className="never-row">
              <Laptop size={16} />
              <span>{name}</span>
              <span className={`never-tag ${index ? "" : "is-good"}`}>{state}</span>
            </div>
          ))}
        </div>
      </li>
    </ul>
  );
}
