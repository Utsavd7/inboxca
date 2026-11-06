import {headers} from "next/headers";

// Where a form about a client's figures or return files goes back to: the return's own page
// (/app/clients/[id]/returns/[task]) when it was sent from there, else the client's page. The
// return page reads the same ?tab=extraction and ?tab=outputs as the client's tabs do.
export async function clientBack(client:string) {
  const from=(await headers()).get("referer"),path=from && URL.canParse(from) ? new URL(from).pathname : "";
  return new RegExp(`^/app/clients/${client}/returns/[0-9a-f-]{36}$`).test(path) ? path : `/app/clients/${client}`;
}
