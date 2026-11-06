import {headers} from "next/headers";
import type {currentMember} from "@/src/lib/member";

// Where a form about a client's figures or return files goes back to: the return's own page
// (/app/clients/[id]/returns/[task]) when it was sent from there, else the client's page. The
// return page reads the same ?tab=extraction and ?tab=outputs as the client's tabs do.
export async function clientBack(client:string) {
  const from=(await headers()).get("referer"),path=from && URL.canParse(from) ? new URL(from).pathname : "";
  return new RegExp(`^/app/clients/${client}/returns/[0-9a-f-]{36}$`).test(path) ? path : `/app/clients/${client}`;
}

// The own page of the one return a prepared form is for, by its form (GSTR1, GSTR3B, ITR1 to
// ITR4, or ITR for the year's figures, Form No. 138, 140, 144 or 143), its period (an ITR's is its
// year, the task's the year's end) and its number; null when no return or more than one matches.
export async function returnPage(supabase:Awaited<ReturnType<typeof currentMember>>["supabase"],firm:string,{client,form,period,registration}:{client:string;form:string;period:string;registration?:string|null}) {
  const itr=/^ITR/.test(form),codes=/^GSTR(1|3B)$/.test(form) ? [`${form}_M`,`${form}_Q`] : form==="TDS143" ? ["TCS_RET"] : /^TDS1(38|40|44)$/.test(form) ? ["TDS_RET"] : [];
  if(!itr && !codes.length) return null;
  const tasks=supabase.from("tasks").select("id").eq("firm_id",firm).eq("client_id",client).eq("kind","compliance").eq("period_key",itr ? `${period}-03` : period).match(registration ? {registration_id:registration} : {});
  const {data}=await (itr ? tasks.like("code","ITR%") : tasks.in("code",codes)).limit(2);
  return data?.length===1 ? `/app/clients/${client}/returns/${data[0].id}` : null;
}
