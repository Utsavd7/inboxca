import { Paper } from "../../../../files/[id]/view/paper";

// A paper opened from a link inside InboxCA: beside the page it was opened from, which stays
// as it was on the left. A reload shows the paper's own page (files/[id]/view).
export default async function PaperBeside({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sheet?: string; show?: string; from?: string }> }) {
  const { sheet, show, from } = await searchParams;
  return <Paper id={(await params).id} asked={sheet} show={show} from={from} pane />;
}
