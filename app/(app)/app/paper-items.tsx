import { FileCheck2, Phone } from "lucide-react";
import Link from "next/link";
import type { WorkItem } from "@/src/lib/work/papers";
import { IconTile, Row } from "./ui";

// Today's paper items (src/lib/work/papers.ts) as rows of Needs you now: call a client asked
// twice with nothing back, or check the figures once every paper is in. Each opens its request.
export function PaperRows({ items }: { items: WorkItem[] }) {
  return (
    <>
      {items.map((item) => {
        const call = item.key.startsWith("call:");
        return (
          <Row
            key={item.key}
            lead={<IconTile Icon={call ? Phone : FileCheck2} kind={call ? "notice" : "done"} />}
            title={item.title}
            meta={item.why}
            action={
              <Link className="b b-secondary" href={item.action.href} aria-label={`${item.action.label}: ${item.client?.name ?? ""}`}>
                {item.action.label}
              </Link>
            }
          />
        );
      })}
    </>
  );
}
