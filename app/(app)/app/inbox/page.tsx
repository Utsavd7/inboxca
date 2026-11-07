import { InboxView, type Search } from "./inbox-view";

// The Inbox: every email with the firm's clients (inbox-view.tsx, which a client's Emails tab
// shows too, for that client).
export default function Inbox({ searchParams }: { searchParams: Promise<Partial<Search>> }) {
  return <InboxView searchParams={searchParams} />;
}
