import {redirect} from "next/navigation";
import {currentMember} from "@/src/lib/member";
import {returnPage} from "../../../return-back";
import {ItrReturn} from "./itr-return";

// A client's income tax return for a year. When the year's one return is on the calendar, it opens
// on that return's own page at its Draft step, with the form, part and message asked for here.
export default async function ItrPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|undefined>>}) {
  const [{id},q]=await Promise.all([params,searchParams]),year=/^20\d{2}$/.test(q.year ?? "") ? q.year! : "2026";
  const {supabase,membership}=await currentMember();
  const own=membership && /^[0-9a-f-]{36}$/.test(id) ? await returnPage(supabase,membership.firmId,{client:id,form:"ITR",period:year}) : null;
  if(own) redirect(`${own}?${new URLSearchParams({...Object.fromEntries(Object.entries(q).filter(([,value])=>typeof value==="string")) as Record<string,string>,step:"draft",year})}`);
  return <ItrReturn id={id} q={q}/>;
}
