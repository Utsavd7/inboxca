import {expect,it,vi} from "vitest";
import type {Job} from "@/src/jobs/runner";
const mock=vi.hoisted(()=>({notify:vi.fn(),status:"needs_reconnect",filters:[] as string[]}));
vi.mock("@/src/lib/push",()=>({notify:mock.notify}));
vi.mock("@/src/lib/supabase",()=>({supabaseAdmin:()=>({from:(table:string)=>({
  select(){return this;},eq(key:string,value:string){mock.filters.push(`${key}:${value}`);return this;},
  maybeSingle:async()=>({data:{firm_id:"firm",status:mock.status}}),
  then(resolve:(value:unknown)=>void){resolve({data:table==="firm_members" ? [{user_id:"owner"}] : [],error:null});},
})})}));
import {mailboxReconnect} from "@/src/jobs/notify";
it("tells the active owner, and skips an alert that reconnect already made obsolete",async()=>{
  const job={entity_id:"mailbox"} as Job,tools={markSending:async()=>{}};
  await mailboxReconnect(job,tools);
  expect(mock.filters).toEqual(expect.arrayContaining(["id:mailbox","firm_id:firm","role:owner","status:active"]));
  expect(mock.notify).toHaveBeenCalledExactlyOnceWith(["owner"],{title:"Connect your firm's email again",body:"InboxCA could not sign in. Replies will wait until you connect it again.",url:"/app/settings#mailbox"});
  mock.status="connected";
  await mailboxReconnect(job,tools);
  expect(mock.notify).toHaveBeenCalledTimes(1);
});
