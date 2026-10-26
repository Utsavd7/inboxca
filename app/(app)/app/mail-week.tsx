import { Inbox } from "lucide-react";
import Link from "next/link";
import type { inboxWeek } from "@/src/lib/work/inbox";
import { Count } from "./motion";
import { Card } from "./ui";

// Today's week of email in four figures, each opening that list in the Inbox.
export async function MailWeek({ week }: { week: ReturnType<typeof inboxWeek> }) {
  const { read, answered, replied, waiting } = await week;
  const figures = [
    { key: "read", filter: "show=in", label: "Emails read", value: read },
    { key: "answered", filter: "status=answered", label: "Answered by InboxCA", value: answered },
    { key: "replied", filter: "status=replied", label: "Answered by your team", value: replied },
    { key: "reply", filter: "status=reply", label: "Waiting for a reply", value: waiting },
  ];
  return (
    <Card id="t-mail" title="Email this week" Icon={Inbox} kind="reply">
      <ul className="mail-week">
        {figures.map((figure) => (
          <li key={figure.key}>
            <Link href={`/app/inbox?when=week&${figure.filter}`}>
              <strong><Count id={`mail-${figure.key}`} value={figure.value} /></strong>
              <span>{figure.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
