import type {currentMember} from "../member";
import {pinWords,type Pin} from "../return-work";
import {todayInIndia} from "../calendar";

export type WorkItem = {
  key: string;
  title: string;
  why: string;
  client?: { id: string; name: string };
  due?: string;
  urgent?: boolean;
  action: { label: string; href: string };
  audience: "assigned" | "approver" | "firm";
  // Given to this person by name (a notice's owner): shown whoever looks after the client.
  mine?: boolean;
};
type Member=Awaited<ReturnType<typeof currentMember>>;

// The one button for each pinned return: where it goes, and what it says. Each opens the return's
// own page at the step it stands at, but an ITR not started yet has no form: its Draft step, where
// the person chooses one.
function action(pin:Pin):[string,string] {
  const client=`/app/clients/${pin.client}`,page=`${client}/returns/${pin.task}`;
  if(pin.kind==="missing") return pin.missing==="return" ? [`${page}?step=draft`,"Start the return"] : [page,"See papers"];
  if(pin.kind==="fill") return [page,"See the return"];
  if(pin.kind==="check") return [page,pin.stage==="filled" && pin.form ? "Check figures" : "See why"];
  return [page,pin.kind==="approve" ? "Review and approve" : "Download and file"];
}

// The returns pinned to this person (public.return_pins, read as them): a draft to approve, an
// approved file to download and file, and from the firm's days before the due date (5 unless
// Settings says otherwise) a return still waiting for papers, a fill or checks, in red. A
// "fill:" item's task id follows the colon, for a Fill button in its place.
export async function formsWorkItems({supabase,membership}:{supabase:Member["supabase"];membership:NonNullable<Member["membership"]>;userId?:string}):Promise<WorkItem[]> {
  const {data}=await supabase.rpc("return_pins",{target_firm:membership.firmId}).throwOnError();
  const today=todayInIndia();
  return ((data ?? []) as Pin[]).map(pin=>{
    const {title,meta}=pinWords(pin,today),[href,label]=action(pin);
    return {key:`${pin.kind}:${pin.task}`,title,why:meta,client:{id:pin.client,name:pin.client_name},due:pin.due_on,urgent:!["approve","approved"].includes(pin.kind),
      action:{label,href},audience:pin.kind==="approve" ? "approver" : "assigned"};
  });
}
