import {beforeEach,expect,it,vi} from "vitest";
import type {Job} from "@/src/jobs/runner";
const mock=vi.hoisted(()=>({send:vi.fn(),insert:vi.fn(),prior:null as Record<string,unknown>|null,same:[] as {id:string}[],approval:false,status:"filed",filters:[] as string[]}));
vi.mock("@/src/lib/shares",()=>({sendShare:mock.send}));
vi.mock("@/src/lib/crypto",()=>({serverCrypto:()=>({decrypt:async()=>"client@invented.test"})}));
vi.mock("@/src/lib/supabase",()=>({supabaseAdmin:()=>({from:(table:string)=>({
  select(){return this;},eq(column:string,value:string){mock.filters.push(`${column}:${value}`);return this;},is(){return this;},
  async limit(){return {data:mock.same,error:null};},
  async maybeSingle(){return {data:table==="shares" ? mock.prior : mock.filters.at(-1)==="id:form" ? {id:"form",client_id:"client",prepared:{form:"GSTR1",registration:"00000000-0000-4000-a000-000000000001",version:1,template:"2.2",status:mock.status,acknowledgement:"00000000-0000-4000-a000-000000000002",sources:[{id:"00000000-0000-4000-a000-000000000003",revision:1}]},clients:{name:"Invented Client",email_enc:"sealed"},firms:{name:"Invented Firm",settings:{records:{approve_all:mock.approval}}}} : {id:"00000000-0000-4000-a000-000000000002",name:"Invented acknowledgement.pdf",document_type:"Acknowledgement",share_policy:null,status:"filed"},error:null};},
  insert:async(value:unknown)=>{mock.insert(value);return {error:null};},
})})}));
import {formAck} from "@/src/jobs/form-ack";
const job={firm_id:"firm",entity_id:"form"} as Job,tools={markSending:async()=>{}};
beforeEach(()=>{vi.clearAllMocks();mock.filters=[];mock.prior=null;mock.same=[];mock.approval=false;mock.status="filed";mock.send.mockResolvedValue(true);});
it("emails the filed acknowledgement through the shared secure-link sender with a stable send id",async()=>{
  expect(await formAck(job,tools)).toEqual({done:true});
  expect(mock.send).toHaveBeenCalledWith(expect.objectContaining({firmId:"firm",waitingId:"form",to:"client@invented.test",documentId:"00000000-0000-4000-a000-000000000002"}));
  expect(mock.filters).toContain("client_id:client");
  mock.send.mockResolvedValue(false);expect(await formAck(job,tools)).toEqual({retry:"mail_not_sent",patient:true});
});
it("keeps private acknowledgements in the Inbox and never shares a draft",async()=>{
  mock.approval=true;expect(await formAck(job,tools)).toEqual({done:true});
  expect(mock.insert).toHaveBeenCalledWith(expect.objectContaining({id:"form",status:"waiting",needs_code:true}));expect(mock.send).not.toHaveBeenCalled();
  mock.prior={status:"waiting",delivery:null};await formAck(job,tools);expect(mock.send).not.toHaveBeenCalled();
  mock.status="draft";mock.approval=false;mock.prior=null;await formAck(job,tools);expect(mock.send).not.toHaveBeenCalled();
});
// Two filed versions of one return with the same acknowledgement number share one filing
// record: the second neither waits for approval again nor emails the client again.
it("shares an acknowledgement paper once when another version of the return already did",async()=>{
  mock.same=[{id:"earlier-form"}];
  mock.approval=true;expect(await formAck(job,tools)).toEqual({done:true});
  mock.approval=false;expect(await formAck(job,tools)).toEqual({done:true});
  expect(mock.insert).not.toHaveBeenCalled();expect(mock.send).not.toHaveBeenCalled();
});
