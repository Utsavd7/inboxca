import {z} from "zod";
import {serverCrypto} from "./crypto";
import {amountsSchema,changedKey,countsOf,extractPurchases,invoiceKey,matchBills,matchChanged,matchPlace,matchSchema,MatchProblem,purchaseMappingPlace,purchaseMappingSchema,readDate,type Changed,type Found,type PurchaseMapping} from "./purchase-register";
import {sameHeadings} from "./sales-register";
import {supabaseAdmin} from "./supabase";
import {workerRead,workerSheet} from "./worker-read";

type Register={id:string;firm_id:string;client_id:string;name:string;sha256:string;period_key:string;registration_id:string|null};
const bill=z.object({gstin:z.string().length(15),name:z.string().max(100),number:z.string().min(1).max(16),date:z.string().max(10),note:z.enum(["C","D"]).optional(),amounts:amountsSchema});
const bills=z.object({gstin:z.string().length(15),period:z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),bills:z.array(bill).max(10000),changed:z.array(bill.extend({was:z.object({number:z.string().min(1).max(16),date:z.string().max(10)})})).max(10000).default([])}).nullable();
export const isRegister=(paper:{name:string})=>/\.(xlsx?|csv)$/i.test(paper.name);

export async function savedPurchaseMappings(firm:string,client:string) {
  const {data}=await supabaseAdmin().from("clients").select("purchase_mapping_enc").eq("firm_id",firm).eq("id",client).single();
  return data?.purchase_mapping_enc ? z.array(purchaseMappingSchema).max(20).parse(JSON.parse(await serverCrypto().decrypt(firm,purchaseMappingPlace(client),data.purchase_mapping_enc))) : [];
}
// The column choices for this layout come first; another layout's stay, up to 20.
async function remember(firm:string,client:string,asked:PurchaseMapping) {
  const admin=supabaseAdmin(),crypto=serverCrypto();
  for(let attempt=0;attempt<3;attempt++) {
    const {data:previous}=await admin.from("clients").select("purchase_mapping_enc").eq("firm_id",firm).eq("id",client).single();
    if(!previous) throw new Error("Client not found");
    const current=previous.purchase_mapping_enc ? z.array(purchaseMappingSchema).parse(JSON.parse(await crypto.decrypt(firm,purchaseMappingPlace(client),previous.purchase_mapping_enc))) : [];
    const enc=await crypto.encrypt(firm,purchaseMappingPlace(client),JSON.stringify([asked,...current.filter((map)=>!sameHeadings(map.headings,asked.headings))].slice(0,20)));
    const update=admin.from("clients").update({purchase_mapping_enc:enc}).eq("firm_id",firm).eq("id",client);
    const {data:changed,error}=await (previous.purchase_mapping_enc ? update.eq("purchase_mapping_enc",previous.purchase_mapping_enc) : update.is("purchase_mapping_enc",null)).select("id").maybeSingle();
    if(error) throw new Error("The column choices could not be remembered.");
    if(changed) return;
  }
  throw new Error("Column choices changed. Try again.");
}

// The month's current GSTR-2B for the register's GSTIN: one named for it first, then one whose
// GSTIN is not known yet (checked against the client's GSTINs once read).
export async function statementFor(register:Register) {
  const {data}=await supabaseAdmin().from("documents").select("id,firm_id,name,sha256,registration_id").eq("firm_id",register.firm_id).eq("client_id",register.client_id).eq("document_type","GSTR-2B").eq("status","filed").eq("period_key",register.period_key).ilike("name","%.json").order("received_at",{ascending:false}).limit(20);
  return data?.find((paper)=>register.registration_id && paper.registration_id===register.registration_id) ?? data?.find((paper)=>!register.registration_id || !paper.registration_id);
}

// For bills and notes the supplier corrected: each original as the client's earlier GSTR-2B
// for the same GSTIN listed it (newest month first, an earlier correction before the bill, from
// the month of the oldest original's date, at most 24 months), and the bills in the earlier
// purchase registers' matches, newest first.
async function earlier(register:Register,read:{gstin:string;changed:Changed[]}) {
  const admin=supabaseAdmin(),from=read.changed.map((bill)=>bill.was.date.slice(0,7)).filter((month)=>/^20\d{2}-\d{2}$/.test(month)).sort()[0] ?? register.period_key;
  const fits=(paper:{registration_id:string|null})=>!register.registration_id || !paper.registration_id || paper.registration_id===register.registration_id;
  const papers=(type:string)=>admin.from("documents").select("id,name,sha256,period_key,registration_id").eq("firm_id",register.firm_id).eq("client_id",register.client_id).eq("document_type",type).eq("status","filed").gte("period_key",from).lt("period_key",register.period_key).order("period_key",{ascending:false}).order("received_at",{ascending:false}).limit(50);
  const [{data:statements},{data:registers}]=await Promise.all([papers("GSTR-2B"),papers("Purchase bills")]);
  const originals=new Map<string,Found>(),months=new Set<string>();
  for(const paper of statements?.filter((paper)=>fits(paper) && /\.json$/i.test(paper.name)) ?? []) {
    if(read.changed.every((one)=>originals.has(changedKey(one,one.was.number))) || months.size>=24) break;
    if(months.has(paper.period_key)) continue;
    months.add(paper.period_key);
    const before=await workerRead(register.firm_id,paper,"portal").then((answer)=>bills.parse(answer.bills ?? null)).catch(()=>null);
    if(before?.gstin!==read.gstin || before.period!==paper.period_key) continue;
    for(const [one,number] of [...before.changed.flatMap((one)=>[[one,one.was.number],[one,one.number]] as const),...before.bills.map((one)=>[one,one.number] as const)])
      if(!originals.has(changedKey(one,number))) originals.set(changedKey(one,number),{amounts:one.amounts,period:paper.period_key});
  }
  const ids=registers?.filter(fits).map((paper)=>paper.id) ?? [],books=new Map<string,Found>();
  const {data:matches}=ids.length ? await admin.from("gst_matches").select("register_id,result_enc").eq("firm_id",register.firm_id).in("register_id",ids) : {data:null};
  for(const paper of registers ?? []) {
    const sealed=matches?.find((match)=>match.register_id===paper.id);
    if(!sealed) continue;
    const before=await openMatch(register.firm_id,paper.id,sealed.result_enc);
    for(const entry of [...before.matched,...before.differ,...before.missing])
      if(entry.books && !books.has(invoiceKey(entry.gstin,entry.number))) books.set(invoiceKey(entry.gstin,entry.number),{amounts:entry.books,period:paper.period_key,rows:entry.rows});
  }
  return {originals,books};
}

// Matches a purchase register with its month's GSTR-2B and keeps the lists. With `asked` (a
// person confirmed the columns) the choice is remembered for the client, even before the
// GSTR-2B is in; without, the client's remembered columns for this layout are used, and a
// register already matched with the current GSTR-2B is left as it is. Throws MatchProblem for
// what a person can fix.
export async function matchPurchases(register:Register,person:string|null,asked?:{header:number;columns:number[]}) {
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(register.period_key)) throw new MatchProblem("month");
  const admin=supabaseAdmin(),crypto=serverCrypto();
  // A client with several GSTINs: a person names the register's first, as for a sales register.
  if(!register.registration_id && ((await admin.from("client_registrations").select("id",{count:"exact",head:true}).eq("firm_id",register.firm_id).eq("client_id",register.client_id).eq("kind","gstin")).count ?? 0)>1) throw new MatchProblem("registration");
  const statement=await statementFor(register);
  if(!asked) {
    if(!statement) return "no_statement";
    const {data:done}=await admin.from("gst_matches").select("statement_id").eq("firm_id",register.firm_id).eq("register_id",register.id).maybeSingle();
    if(done?.statement_id===statement.id) return "matched";
  }
  const rows=await workerSheet(register.firm_id,register);
  if(asked && !rows[asked.header]?.length) throw new MatchProblem("columns");
  const saved=asked ? [] : (await savedPurchaseMappings(register.firm_id,register.client_id)).filter((map)=>sameHeadings(rows[map.header] ?? [],map.headings));
  const mapping=asked ? {...asked,headings:rows[asked.header] ?? []} : saved.length===1 ? saved[0] : undefined;
  if(!mapping) return "no_columns";
  const {bills:books,skipped}=extractPurchases(rows,mapping);
  if(asked) await remember(register.firm_id,register.client_id,purchaseMappingSchema.parse(mapping));
  if(!statement) return "no_statement";
  const read=bills.parse((await workerRead(register.firm_id,statement,"portal")).bills ?? null);
  if(!read) throw new MatchProblem("layout");
  if(read.period!==register.period_key) throw new MatchProblem("period");
  // The GSTR-2B must be for one of the client's GSTINs, and the register's own when it names one.
  const {data:own}=await admin.from("client_registrations").select("id").eq("firm_id",register.firm_id).eq("client_id",register.client_id).eq("kind","gstin").eq("number_bidx",await crypto.blindIndex(register.firm_id,"gstin",read.gstin)).maybeSingle();
  if(!own || register.registration_id && own.id!==register.registration_id) throw new MatchProblem("gstin");
  const result=matchBills(books,read.bills.map((bill)=>({...bill,date:readDate(bill.date)})),skipped);
  if(read.changed.length) {
    const changed=read.changed.map((bill)=>({...bill,date:readDate(bill.date),was:{...bill.was,date:readDate(bill.was.date)}})),found=await earlier(register,{gstin:read.gstin,changed});
    matchChanged(result,changed,found.originals,found.books);
  }
  const counts=countsOf(result);
  const {error}=await admin.from("gst_matches").upsert({register_id:register.id,firm_id:register.firm_id,statement_id:statement.id,counts,result_enc:await crypto.encrypt(register.firm_id,matchPlace(register.id),JSON.stringify(result))},{onConflict:"register_id"});
  if(error) throw new Error("The match could not be saved.");
  await admin.from("activity_log").insert({firm_id:register.firm_id,actor_id:person,action:"gst_match.made",entity_type:"client",entity_id:register.client_id,details:{register:register.id,statement:statement.id,differences:counts.missing+counts.extra+counts.differ+(counts.changed ?? 0)}});
  return "matched";
}

// A GSTR-2B just read: each purchase register of its client and month is matched with it, by
// the client's remembered columns. One that needs a person waits for them.
export async function matchStatement(statement:{firm_id:string;client_id:string;period_key:string;registration_id:string|null}) {
  const {data:registers}=await supabaseAdmin().from("documents").select("id,firm_id,client_id,name,sha256,period_key,registration_id").eq("firm_id",statement.firm_id).eq("client_id",statement.client_id).eq("document_type","Purchase bills").eq("work_type","gst").eq("status","filed").eq("period_key",statement.period_key).limit(20);
  for(const register of registers?.filter((paper)=>isRegister(paper) && (!paper.registration_id || !statement.registration_id || paper.registration_id===statement.registration_id)) ?? [])
    try {await matchPurchases(register,null);} catch(error) {if(!(error instanceof MatchProblem)) throw error;}
}

export async function openMatch(firm:string,register:string,sealed:string) {
  return matchSchema.parse(JSON.parse(await serverCrypto().decrypt(firm,matchPlace(register),sealed)));
}
