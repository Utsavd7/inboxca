import {expect,it,vi} from "vitest";
const ids={form:"00000000-0000-4000-a000-000000000001",firm:"00000000-0000-4000-a000-000000000002",client:"00000000-0000-4000-a000-000000000003",person:"00000000-0000-4000-a000-000000000004",paper:"00000000-0000-4000-a000-000000000005"};
const mock=vi.hoisted(()=>({save:vi.fn(),insert:vi.fn(),rpc:vi.fn(),record:""}));
vi.mock("@/src/lib/member",()=>({currentWriter:async()=>({userId:ids.person,membership:{firmId:ids.firm,firmName:"Invented Firm",may:()=>true,settings:{records:{approve_all:true}}},supabase:{from:(table:string)=>({
  select(){return this;},eq(){return this;},neq(){return this;},
  async single(){return {data:{name:"Invented Client"}};},
  async maybeSingle(){return {data:table==="documents" ? {id:ids.form,firm_id:ids.firm,client_id:ids.client,name:"Invented GSTR-1.xlsx",period_key:"2026-09",prepared:{form:"GSTR1",registration:ids.form,version:1,template:"2.2",sources:[{id:ids.form,revision:1}],status:"approved"}} : null};},
})}})}));
vi.mock("@/src/lib/supabase",()=>({supabaseAdmin:()=>({rpc:mock.rpc,from:(table:string)=>({
  select(){return this;},eq(){return this;},
  insert(value:unknown){mock.insert(table,value);return this;},
  async maybeSingle(){return {data:table==="connected_accounts" ? {id:"account",provider:"local",credentials_enc:"sealed"} : null};},
  async single(){return {data:{id:ids.paper},error:null};},
  then(resolve:(value:unknown)=>void){resolve({error:null});},
})})}));
vi.mock("@/src/lib/drive-account",()=>({openDrive:async()=>({ensureFolder:async()=>"Prepared",save:mock.save,trash:vi.fn()})}));
import {paperPolicy} from "@/src/lib/records";
import {fileForm} from "@/src/lib/prepared";

it("records an entered filing number as the firm's own paper, applies private sharing and refuses an empty acknowledgement",async()=>{
  mock.rpc.mockResolvedValue({data:true,error:null});
  mock.save.mockImplementation(async(_folder:string,_name:string,bytes:Uint8Array)=>{mock.record=new TextDecoder().decode(bytes);return {id:"invented-record"};});
  await fileForm(ids.form,"INVENTED-ACK-123");
  expect(mock.record).toContain("Acknowledgement number entered by your firm: INVENTED-ACK-123");
  expect(mock.record).toContain("It is not the portal acknowledgement");
  expect(mock.insert).toHaveBeenCalledWith("documents",expect.objectContaining({document_type:"Filing record",share_policy:null,period_key:"2026-09"}));
  const paper=mock.insert.mock.calls.find(([table])=>table==="documents")![1];
  expect(paperPolicy(paper,{approve_all:true})).toBe("approval");
  expect(paperPolicy(paper,{routine:[]})).toBe("approval");
  expect(mock.rpc).toHaveBeenCalledWith("file_prepared_form",{target:ids.form,person:ids.person,acknowledgement:"INVENTED-ACK-123",paper:ids.paper});
  await expect(fileForm(ids.form,"")).rejects.toThrow("Add the acknowledgement");
});
