import {afterEach,expect,it,vi} from "vitest";
import type {BulkSend} from "@/src/lib/records";
import type {Job} from "@/src/jobs/runner";
const mock=vi.hoisted(()=>({status:"pending",details:{} as BulkSend}));
vi.mock("@/src/lib/supabase",()=>({supabaseAdmin:()=>({from:(table:string)=>({
  write:false,select(){return this;},eq(){return this;},
  update(value:{status?:string;details?:BulkSend}){this.write=true;if(value.status)mock.status=value.status;return this;},
  async maybeSingle(){return {data:table==="requests" ? {id:"request",firm_id:"firm",status:mock.status,details:mock.details,firms:{name:"Invented Firm",settings:{}}} : table==="clients" ? {name:"Invented Client",email_enc:null} : null,error:null};},
  then(resolve:(value:unknown)=>void){resolve({data:this.write ? null : [],error:null});},
})})}));
import {bulkSend,bulkShareId} from "@/src/jobs/bulk-send";
afterEach(()=>vi.useRealTimers());
it("handles 25 clients, waits ten minutes and resumes the remaining clients",async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-20T05:00:00Z"));mock.status="pending";
  mock.details={by:"owner",day:"2026-10-20",type:"ITR-V",period:"2025",clients:Array.from({length:26},(_,id)=>({id:String(id),share:String(id)}))};
  const job={entity_id:"request"} as Job,tools={markSending:async()=>{}};
  expect(await bulkSend(job,tools)).toEqual({retry:"more_clients",at:new Date("2026-10-20T05:10:00Z")});
  expect(mock.details.clients.filter((client)=>client.state==="skipped")).toHaveLength(25);
  expect(mock.status).toBe("pending");
  expect(await bulkSend(job,tools)).toEqual({done:true});
  expect(mock.details.clients.filter((client)=>client.state==="skipped")).toHaveLength(26);
  expect(mock.status).toBe("done");
});
it("keeps different firms, papers, clients and days in separate sends",()=>{
  expect(bulkShareId("firm","paper","client","2026-10-20")).not.toBe(bulkShareId("firm","paper","client","2026-10-21"));
  for (const [firm,paper,client] of [["other","paper","client"],["firm","other","client"],["firm","paper","other"]]) expect(bulkShareId("firm","paper","client","2026-10-20")).not.toBe(bulkShareId(firm,paper,client,"2026-10-20"));
});
