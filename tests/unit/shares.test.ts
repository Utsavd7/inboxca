import { beforeEach, expect, it, vi } from "vitest";
const mock=vi.hoisted(()=>({send:vi.fn(),found:vi.fn(),finish:vi.fn(),existing:null as Record<string,unknown>|null,policy:null as string|null, saved:undefined as unknown, collision:false, rejectContact:false, cas:[] as string[]}));
vi.mock("@/src/lib/firm-mail",()=>({firmMailer:async()=>({send:mock.send,sentAlready:mock.found})}));
vi.mock("@/src/lib/crypto",()=>({serverCrypto:()=>({encrypt:async()=>"encrypted test link",decrypt:async()=>"invented-link-token"})}));
vi.mock("@/src/lib/supabase",()=>({supabaseAdmin:()=>({rpc:mock.finish,from:(table:string)=>({
  write:false,
  select(){return this;},eq(column:string,value:unknown){if(column==="delivery")mock.cas.push(value as string);return this;},is(){return this;},
  insert(value:unknown){this.write=true;mock.saved=value;return this;},
  update(value:unknown){this.write=true;mock.saved=value;return this;},
  single(){return this.maybeSingle();},
  async maybeSingle(){return {data:this.write ? mock.collision ? null : {id:"share"} : table==="documents" ? {client_id:"client",document_type:"ITR-V",share_policy:mock.policy,status:"filed"} : table==="firms" ? {settings:{}} : table==="contact_clients" ? mock.rejectContact ? null : {contact_id:"contact"} : mock.existing};},
})})}));
import {sendShare} from "@/src/lib/shares";
const share={firmId:"firm",firmName:"Invented Firm",documentId:"paper",documentName:"Invented ITR-V",clientName:"Invented Client",contactId:null,to:"client@invented.test",waitingId:"share"};
beforeEach(()=>{vi.clearAllMocks();mock.existing=null;mock.policy=null;mock.collision=false;mock.rejectContact=false;mock.cas=[];mock.send.mockResolvedValue(true);mock.found.mockResolvedValue(false);mock.finish.mockResolvedValue({error:null});});
// M5 acceptance: a possible send is reconciled by Message-ID, never sent a second time.
it("finishes a send found in Sent after a crash without sending it again",async()=>{
  mock.existing={firm_id:"firm",document_id:"paper",status:"waiting",delivery:{state:"sending",link_enc:"encrypted test link"}};
  mock.found.mockResolvedValue(true);
  expect(await sendShare(share)).toBe(true);
  expect(mock.send).not.toHaveBeenCalled();
  expect(mock.found).toHaveBeenCalledWith(expect.stringMatching(/^<share-share@/));
  expect(mock.finish).toHaveBeenCalledWith("finish_share",{share_id:"share"});
});
it("keeps a recoverable send with a stable Message-ID and removes its token only on completion",async()=>{
  expect(await sendShare(share)).toBe(true);
  expect(mock.saved).toMatchObject({status:"waiting",delivery:{state:"sending",link_enc:"encrypted test link"}});
  expect(mock.send.mock.calls[0][3]).toMatch(/^<share-share@/);
  expect(mock.finish).toHaveBeenCalledOnce();
});
it("does not resend a finished share or send an internal paper",async()=>{
  mock.existing={firm_id:"firm",document_id:"paper",status:"sent",delivery:{state:"sent"}};
  expect(await sendShare(share)).toBe(true);
  mock.policy="internal";
  expect(await sendShare(share)).toBe(false);
  expect(mock.send).not.toHaveBeenCalled();
});
it("refuses an overlapping attempt or a failed mailbox check",async()=>{
  mock.collision=true;
  expect(await sendShare(share)).toBe(false);
  expect(mock.send).not.toHaveBeenCalled();
  mock.existing={firm_id:"firm",document_id:"paper",status:"waiting",delivery:{state:"sending",until:new Date(Date.now()+120_000).toISOString(),link_enc:"encrypted test link"}};
  expect(await sendShare(share)).toBe(false);
  mock.found.mockRejectedValue(new Error("sent_not_read"));
  await expect(sendShare(share)).rejects.toThrow("sent_not_read");
  expect(mock.send).not.toHaveBeenCalled();
});

it("resumes a confirmed unsent attempt with a serialized comparison and refuses a revoked contact",async()=>{
  const prior={state:"sending",link_enc:"encrypted test link"};
  mock.existing={firm_id:"firm",document_id:"paper",status:"waiting",delivery:prior};
  expect(await sendShare(share)).toBe(true);
  expect(mock.cas).toEqual([JSON.stringify(prior)]);
  mock.send.mockClear();mock.rejectContact=true;
  expect(await sendShare({...share,contactId:"contact"})).toBe(false);
  expect(mock.send).not.toHaveBeenCalled();
});
