import {randomUUID} from "node:crypto";
import {beforeEach,expect,it,vi} from "vitest";
import catalog from "../../reference/official/templates.json";
import {checkedForm} from "@/src/lib/prepare-form";
import {inventedGstin} from "../fixtures/portal";

const mocked=vi.hoisted(()=>({member:vi.fn(),figures:vi.fn(),grant:vi.fn(),decrypt:vi.fn()}));
vi.mock("@/src/lib/member",()=>({currentWriter:mocked.member}));
vi.mock("@/src/lib/datasets",()=>({confirmedFigures:mocked.figures}));
vi.mock("@/src/lib/permission-grants",()=>({grantFor:mocked.grant}));
vi.mock("@/src/lib/crypto",()=>({serverCrypto:()=>({decrypt:mocked.decrypt})}));
const firm=randomUUID(),client=randomUUID(),registration=randomUUID(),id=randomUUID(),user=randomUUID();
const input={client,registration,form:"GSTR1",period:"2026-09",drafts:[id]};
let data:Record<string,unknown>,filters:[string,string,unknown][];
beforeEach(()=>{
  vi.clearAllMocks();filters=[];
  data={clients:{id:client},client_registrations:[{id:registration,number_enc:"invented encrypted tax number"}],datasets:[{id,revision:1,data:{}}],templates:catalog.filter(row=>row.form_code==="GSTR1")};
  mocked.member.mockImplementation(async()=>({userId:user,membership:{firmId:firm,may:()=>true},supabase:{from:(table:string)=>({select(){return this;},eq(key:string,value:unknown){filters.push([table,key,value]);return this;},in(){return this;},maybeSingle(){return this;},then(resolve:(value:unknown)=>void){resolve({data:data[table]});}})}}));
  mocked.decrypt.mockResolvedValue(inventedGstin());mocked.grant.mockResolvedValue(null);mocked.figures.mockResolvedValue(new Map([["b2cs.r2.c4",{label:"Taxable value",value:"100"}]]));
});
it("uses the person's scoped reads and the confirmed-figures gate before signing work",async()=>{
  const {request,permission}=await checkedForm(input);
  expect(request).toMatchObject({firm,client,registration,gstin:inventedGstin(),period:"2026-09",template:{version:"2.2"}});expect(permission).toBeNull();
  expect(mocked.figures).toHaveBeenCalledWith(firm,id,{});
  for(const table of ["clients","client_registrations","datasets"]) expect(filters).toContainEqual([table,"firm_id",firm]);
  mocked.figures.mockRejectedValueOnce(new Error("Every figure must pass the check first."));
  await expect(checkedForm(input)).rejects.toThrow("Every figure");
});
it("refuses hidden work, missing permission and ambiguous registrations",async()=>{
  data.clients=null;await expect(checkedForm(input)).rejects.toThrow("not be found");expect(mocked.figures).not.toHaveBeenCalled();
  data.clients={id:client};data.client_registrations=[{id:registration,number_enc:"invented value"},{id:randomUUID(),number_enc:"invented second value"}];
  await expect(checkedForm(input)).rejects.toThrow("GST number choice");
  const member=await mocked.member();mocked.member.mockResolvedValue({...member,membership:{firmId:firm,may:()=>false}});
  await expect(checkedForm(input)).rejects.toThrow("permission");
});
