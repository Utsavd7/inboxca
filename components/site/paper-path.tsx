import "./paper-path.css";
import { FileText, Folder, Mail, Monitor } from "lucide-react";
import { Chip } from "./help-art";
import { Logo } from "./logo";

// The path of a client's paper, under the security policy's heading: each step as
// content/security.ts says it, beside a small still card of it in sample data.
const steps = [
  [
    <Mail key="i" size={16} />,
    "Patel Textiles",
    "To your firm's email",
    <span key="o" className="attachment">
      <FileText size={13} />
      <span className="num">IMG_2291.pdf</span>
    </span>,
    "A client emails the paper to your firm's own address.",
  ],
  [<Logo key="i" markOnly />, "InboxCA", "For Patel Textiles", <Chip key="o">Purchase bills</Chip>, "InboxCA reads it, after your email provider has checked it."],
  [
    <Folder key="i" size={16} />,
    "Your OneDrive",
    "InboxCA, FY 2026-27",
    <span key="o" className="attachment">
      <Folder size={13} />
      <span>Patel Textiles</span>
    </span>,
    "It is filed in your firm's own OneDrive or Dropbox. InboxCA does not keep it.",
  ],
  [<Monitor key="i" size={16} />, "Front desk PC", "In office hours", <Chip key="o" tone="done">Approved</Chip>, "Staff open it through InboxCA. With Office only, that is on approved PCs, in office hours."],
] as const;

export function PaperPath() {
  return (
    <figure className="pp" aria-label="The path of a client's paper, with sample data">
      <ol>
        {steps.map(([icon, title, line, thing, text]) => (
          <li key={text}>
            <span className="pp-art" aria-hidden>
              {icon}
              <strong>{title}</strong>
              <small>{line}</small>
              {thing}
            </span>
            <span className="pp-text">{text}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
