import "./setup-art.css";
import type { ReactNode } from "react";
import { Chip, Rows, Sheet } from "@/components/site/help-art";

// What a place shows once it is set up, for its empty or not connected state only: a still of
// the help pages' small window (components/site/help-art.tsx) with its rows in sample data and
// marked Example, so nobody takes it for theirs. The last rows are filler and fade out.
const more = [<i key="t" className="sa-bar" />, <i key="l" className="sa-bar" />] as const;
const scenes = {
  inbox: [
    "Inbox",
    [["Patel Textiles", "Purchase bills for September", <Chip key="c" tone="done">Papers saved</Chip>], ["Mehta Traders", "A question about our fees", <Chip key="c">Needs reply</Chip>], more, more],
  ],
  documents: [
    "Documents",
    [["Purchase bills, Sep 2026", "Patel Textiles, saved in your OneDrive"], ["Bank statement, Sep 2026", "Iyer Foods, from their email", <Chip key="c">To check</Chip>], more, more],
  ],
  clients: [
    "Clients",
    [["Patel Textiles", "Business. Looked after by Ravi Kumar"], ["Iyer Foods", "Company. Looked after by Neha Shah"], more, more],
  ],
  calendar: [
    "Calendar",
    [["Mehta Traders", "GSTR-3B, Sep 2026", <Chip key="c" tone="late">Late</Chip>], ["Patel Textiles", "GSTR-1, Sep 2026", <Chip key="c">Due in 7 days</Chip>], more, more],
  ],
  notices: [
    "Notices",
    [["Patel Textiles", "Intimation u/s 143(1)", <Chip key="c">Date to check</Chip>], ["Iyer Foods", "Intimation u/s 143(1)", <Chip key="c" tone="done">Replied</Chip>], more, more],
  ],
} satisfies Record<string, readonly [string, readonly (readonly [ReactNode, ReactNode?, ReactNode?])[]]>;

export function SetupArt({ scene }: { scene: keyof typeof scenes | "import" }) {
  const [title, body] =
    scene === "import"
      ? [<span key="t" className="num">Clients.xlsx</span>, <Sheet key="s" rows={[["Name", "Client type"], ["Patel Textiles", "Business"], ["Iyer Foods", "Company"], ["", ""], ["", ""], ["", ""]]} />]
      : [scenes[scene][0], <Rows key="r" rows={scenes[scene][1]} />];
  return (
    <div className="hs sa" aria-hidden>
      <div className="hs-window">
        <div className="hs-bar">
          <strong>{title}</strong>
          <span className="sa-tag">Example</span>
        </div>
        <div className="hs-view">{body}</div>
      </div>
    </div>
  );
}
