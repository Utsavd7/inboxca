import {randomUUID} from "node:crypto";
import {expect,it,vi} from "vitest";
import catalog from "../../reference/official/templates.json";
import {verifyForm,type FormRequest} from "@/src/lib/form-worker";
import {signView,verifyView} from "@/src/lib/file-worker";
import {templateSchema} from "@/src/lib/templates";
import {prepare} from "../../worker/prepare";
import {inventedGstin} from "../fixtures/portal";

const secret="invented-form-worker-test-secret"; // ggignore: test-only HMAC key.
const input=():FormRequest=>({purpose:"prepare",firm:randomUUID(),client:randomUUID(),registration:randomUUID(),gstin:inventedGstin(),period:"2026-09",expires:1060,template:templateSchema.parse(catalog[1]),drafts:[{id:randomUUID(),revision:1,figures:[["b2cs.r2.c4",{label:"Taxable value",value:"100"}]]}]});
it("binds the signed form request to the firm, figures, revision, registration, period and template",async()=>{
  const request=input(),body=JSON.stringify(request),signature=await signView(body,secret);
  expect(await verifyForm(body,signature,secret,"GSTR1",1000)).toEqual(request);
  for(const change of [{firm:randomUUID()},{gstin:inventedGstin("ZZZPZ0002Z")},{period:"2026-08"},{registration:randomUUID()},{drafts:[{...request.drafts[0],revision:2}]}]) await expect(verifyForm(JSON.stringify({...request,...change}),signature,secret,"GSTR1",1000)).rejects.toThrow();
  for(const [form,now] of [["GSTR3B",1000],["GSTR1",1060],["GSTR1",900]] as const) await expect(verifyForm(body,signature,secret,form,now)).rejects.toThrow();
  await expect(verifyForm(body,signature,"","GSTR1",1000)).rejects.toThrow();
  await expect(verifyView(body,signature,secret,"GSTR1",1000)).rejects.toThrow();
  const repeat=JSON.stringify({...request,drafts:[request.drafts[0],request.drafts[0]]});
  await expect(verifyForm(repeat,await signView(repeat,secret),secret,"GSTR1",1000)).rejects.toThrow();
});
it("keeps unpublished GSTR-3B files blocked instead of inventing a live version",()=>{
  const request={...input(),template:templateSchema.parse(catalog[2])};
  expect(()=>prepare(request)).toThrow("not ready");
  request.template={...request.template,status:"active",valid_from:"2026-09-01"};
  expect(()=>prepare(request)).toThrow("not ready");
});

it("returns a filled workbook through the signed worker route and refuses another form",async()=>{
  vi.stubEnv("FILE_WORKER_SECRET",secret);
  try {
    const {handle}=await import("../../worker/handler");
    const request=input();request.expires=Math.floor(Date.now()/1000)+60;
    request.drafts[0].figures=["OE","24-Gujarat","","18","100","0"].flatMap((value,column)=>value ? [[`b2cs.r2.c${column}`,{label:"Invented field",value}] as [string,{label:string;value:string}]] : []);
    const body=JSON.stringify(request),signature=await signView(body,secret);
    const call=(form:string,authorization=signature)=>handle(new Request(`http://worker/prepare/${form}`,{method:"POST",headers:{authorization},body}));
    const response=await call("GSTR1");expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer()).slice(0,2)).toEqual(Uint8Array.of(80,75));
    expect((await call("GSTR3B")).status).toBe(403);expect((await call("GSTR1","wrong")).status).toBe(403);
  } finally {vi.unstubAllEnvs();}
});
