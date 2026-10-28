import { notFound } from "next/navigation";

// The paper pane's slot (@doc) matches every address, so one with no page here (a download, or
// a mistyped address) says it is not there, as it did before the pane.
export default function NoPage() {
  notFound();
}
