import Link from "next/link";
import { Check, FolderCheck, HardDrive, LockKeyhole, Mail, Reply, UserCheck } from "lucide-react";
import { Logo } from "./logo";

// The line and three facts on the navy side, then one email as InboxCA handles it: read, filed
// in the firm's own drive, and answered from the firm's own address (content/site.ts
// demoSteps). No client is named; only the file name is in figures.
const steps = [
  [Mail, "An email from a client", "form-130.pdf", "mono"],
  [FolderCheck, "Filed in the client's folder", "In your own drive, with a clear name", undefined],
  [Reply, "Answered from your firm's address", "Anything unusual goes to your team", undefined],
] as const;
const facts = [
  [HardDrive, "Papers stay in your own OneDrive or Dropbox"],
  [UserCheck, "Your team approves every form before it is filed"],
  [LockKeyhole, "2 step sign in and a record nobody can edit"],
] as const;

// The sign in screens: sign in, sign up, the 2 step code, plan and payment, and the app's gates
// for someone not in a firm yet. The form on the left; on a laptop InboxCA's navy side beside it
// (not for the plan step, which needs the whole width).
export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-side">
        <header className="auth-top">
          <Link href="/" aria-label="InboxCA home">
            <Logo />
          </Link>
        </header>
        <main className="auth-card">{children}</main>
        <footer className="auth-foot">
          <span>InboxCA by Orelu</span>
          <nav aria-label="Policies">
            <Link href="/security">Security</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/help">Help</Link>
          </nav>
        </footer>
      </div>
      <aside className="auth-band" aria-label="About InboxCA">
        <p className="auth-band-title">
          Every client email, <span>read, filed and answered.</span>
        </p>
        <ul className="auth-facts">
          {facts.map(([Icon, text]) => (
            <li key={text}>
              <Icon size={16} aria-hidden />
              {text}
            </li>
          ))}
        </ul>
        {/* The card runs off the foot of the navy side, over rows with no words. */}
        <div className="auth-flow" aria-hidden>
          <p>
            <span className="status-dot" /> One email, handled by InboxCA
          </p>
          <ol>
            {steps.map(([Icon, title, line, mono]) => (
              <li key={title}>
                <span className="auth-flow-icon">
                  <Icon size={16} />
                </span>
                <span>
                  <strong>{title}</strong>
                  <small className={mono}>{line}</small>
                </span>
                <Check className="auth-flow-done" size={16} strokeWidth={3} />
              </li>
            ))}
            {[0, 1].map((row) => (
              <li key={row} className="auth-flow-rest">
                <span className="auth-flow-icon" />
                <span>
                  <i />
                  <i />
                </span>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}
