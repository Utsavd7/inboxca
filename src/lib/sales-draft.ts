import {randomUUID} from "node:crypto";
import {z} from "zod";
import {createDraft,type Draft} from "./datasets";
import {serverCrypto} from "./crypto";
import {exactMapping,extractSales,mappingSchema,sameHeadings,type SalesMapping} from "./sales-register";
import {supabaseAdmin} from "./supabase";
import {workerSheets} from "./worker-read";

export async function savedSalesMappings(firm:string,client:string) {
  const {data}=await supabaseAdmin().from("clients").select("sales_mapping_enc").eq("firm_id",firm).eq("id",client).single();
  return data?.sales_mapping_enc ? z.array(mappingSchema).max(20).parse(JSON.parse(await serverCrypto().decrypt(firm,`clients/${client}/sales_mapping`,data.sales_mapping_enc))) : [];
}
export async function readSales(document:{id:string;firm_id:string;client_id:string;name:string;sha256:string;period_key:string},person:string|null,asked?:SalesMapping,permission:string|null=null,registration?:string) {
  const admin=supabaseAdmin();
  const {data:existing}=await admin.from("datasets").select("id").eq("firm_id",document.firm_id).eq("client_id",document.client_id).eq("id",document.id).maybeSingle();
  if(existing) return existing.id;
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(document.period_key)) throw new Error("Choose the register's month first.");
  const {rows,sheet,more}=await workerSheets(document.firm_id,document),saved=await savedSalesMappings(document.firm_id,document.client_id);
  const matches=saved.filter((map)=>sameHeadings(rows[map.header] ?? [],map.headings));
  const mapping=asked ?? (matches.length===1 ? matches[0] : matches.length ? undefined : exactMapping(rows));
  if(!mapping) return null;
  // The workbook's other sheets with a register's official headings are read too, a section each.
  const sheets=[{sheet,rows,mapping},...more.map((other)=>({...other,mapping:exactMapping(other.rows)}))];
  if(sheets.some((part)=>!part.mapping) || new Set(sheets.map((part)=>part.mapping!.section)).size<sheets.length) throw new Error("Keep each section of the register on one sheet.");
  const lines=sheets.flatMap((part)=>extractSales(part.rows,part.mapping!).map((value)=>({...value,id:randomUUID(),source:{document:document.id,sha256:document.sha256,page:Math.ceil(value.row/40),sheet:part.sheet,cell:`${String.fromCharCode(65+value.column)}${value.row}`}})));
  if(lines.length>10000) throw new Error("Use a register with 1 to 10,000 filled fields.");
  const same=(line:{field:string},total:{field:string})=>line.field.split(".")[0]===total.field.split(".")[0] && line.field.split(".").at(-1)===total.field.split(".").at(-1);
  const checks:Draft["checks"]=lines.filter((line)=>line.total && /Value|Amount/.test(line.label)).map((total)=>({kind:"sum",parts:lines.filter((line)=>!line.total && same(line,total)).map((line)=>line.id),total:total.id}));
  const created=await createDraft({id:document.id,firm_id:document.firm_id,client_id:document.client_id,form_code:"GSTR1",period_key:document.period_key,lines,checks,registration},person,permission);
  if(!created) throw new Error("The draft changed or permission expired. Open it again.");
  if(asked) {
    for(let attempt=0;attempt<3;attempt++) {
      const {data:previous}=await admin.from("clients").select("sales_mapping_enc").eq("firm_id",document.firm_id).eq("id",document.client_id).single();
      if(!previous) throw new Error("Client not found");
      const current=previous.sales_mapping_enc ? z.array(mappingSchema).parse(JSON.parse(await serverCrypto().decrypt(document.firm_id,`clients/${document.client_id}/sales_mapping`,previous.sales_mapping_enc))) : [];
      const mappings=[asked,...current.filter((map)=>map.section!==asked.section || !sameHeadings(map.headings,asked.headings))].slice(0,20);
      const enc=await serverCrypto().encrypt(document.firm_id,`clients/${document.client_id}/sales_mapping`,JSON.stringify(mappings));
      const update=admin.from("clients").update({sales_mapping_enc:enc}).eq("firm_id",document.firm_id).eq("id",document.client_id);
      const {data:changed,error}=await (previous.sales_mapping_enc ? update.eq("sales_mapping_enc",previous.sales_mapping_enc) : update.is("sales_mapping_enc",null)).select("id").maybeSingle();
      if(error) throw new Error("The figures were saved, but the column choices could not be remembered.");
      if(changed) return document.id;
    }
    throw new Error("Column choices changed. Open the draft again.");
  }
  return document.id;
}
