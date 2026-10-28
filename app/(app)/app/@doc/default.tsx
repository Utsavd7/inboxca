// The paper pane is empty unless a link inside InboxCA opened a paper beside the page
// (@doc/(.)files). Going to Today (page.tsx) or any other page ([...rest]) empties it again.
export default function NoPaper() {
  return null;
}
