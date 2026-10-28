import { Paper } from "./paper";

// A paper as its own page: a link opened in a new tab, a reload, or Open full page. A link
// inside InboxCA opens it beside the page instead (@doc).
export default async function ViewFile({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sheet?: string }> }) {
  return <Paper id={(await params).id} asked={(await searchParams).sheet} />;
}
