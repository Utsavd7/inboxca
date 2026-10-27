import Form from "next/form";
import Link from "next/link";
import {redirect} from "next/navigation";
import {z} from "zod";
import {dueLabel} from "@/src/lib/calendar";
import {serverCrypto} from "@/src/lib/crypto";
import {periodName} from "@/src/lib/documents";
import {currentMember,currentWriter} from "@/src/lib/member";
import {isRegister,matchPurchases,openMatch,savedPurchaseMappings,statementFor} from "@/src/lib/purchase-match";
import {agrees,changeGap,changeOf,changeState,changeTotal,MatchProblem,matchLine,purchaseFields,rupees,suggestColumns,taxOf,totalOf,type Amounts,type Counts,type Entry} from "@/src/lib/purchase-register";
import {sameHeadings} from "@/src/lib/sales-register";
import {supabaseAdmin} from "@/src/lib/supabase";
import {workerSheet} from "@/src/lib/worker-read";
import {Pending} from "../../pending";

const problems:Record<string,string>={
  permission:"Ask your firm's owner to let you check figures for this client.",
  source:"This purchase register is not available. Choose another one.",
  month:"Choose the register's month on the Documents tab first.",
  registration:"Choose the GSTIN this register is for.",
  columns:"The columns changed. Check them again.",
  needed:"Choose the columns for the supplier's GSTIN, the invoice number and the taxable value.",
  distinct:"Choose a different column for each field.",
  empty:"No bills with a supplier GSTIN were found under these columns. Check the row with the column names.",
  layout:"The GSTR-2B could not be read. Add the JSON file from the GST portal.",
  period:"This GSTR-2B is for another month. Add the one for the register's month.",
  gstin:"This GSTR-2B is for another GSTIN. Check the client's GSTIN and the register's.",
  download:"Ask your firm's owner to let you download this client's files.",
  read:"The register could not be read. Check the drive connection and the file. The first sheet may have up to 1,000 rows and 26 columns.",
};
const problem=(code?:string)=>{const cell=/^cell-([3-7])-(\d{1,4})$/.exec(code ?? "");return cell ? `Check ${purchaseFields[Number(cell[1])]} in row ${cell[2]}.` : problems[code ?? ""];};

async function matchRegister(form:FormData) {
  "use server";
  const {supabase,membership,userId}=await currentWriter();
  if(!membership) redirect("/app");
  const client=z.uuid().parse(form.get("client")),id=z.uuid().parse(form.get("register"));
  // A problem brings the columns back on the row the person chose.
  const row=z.coerce.number().int().min(1).max(40).catch(1).parse(form.get("header"));
  const back=(code:string)=>`/app/clients/${client}?tab=extraction&purchases=${id}&match=${code}${["matched","no_statement"].includes(code) ? "" : `&heading=${row}`}#gst-match`;
  if(!membership.may("check_figures",client)) redirect(back("permission"));
  const {data:register}=await supabase.from("documents").select("id,firm_id,client_id,name,sha256,period_key,registration_id").eq("firm_id",membership.firmId).eq("client_id",client).eq("id",id).eq("work_type","gst").eq("document_type","Purchase bills").eq("status","filed").maybeSingle();
  if(!register || !isRegister(register)) redirect(back("source"));
  let outcome="read";
  try {
    // A client with several GSTINs names the register's one; the paper keeps it, as for sales.
    const registration=form.get("registration") ? z.uuid().parse(form.get("registration")) : null;
    if(registration && !register.registration_id) {
      if(!(await supabase.from("client_registrations").select("id").eq("firm_id",membership.firmId).eq("client_id",client).eq("id",registration).eq("kind","gstin").maybeSingle()).data) throw new MatchProblem("registration");
      await supabaseAdmin().from("documents").update({registration_id:registration}).eq("firm_id",membership.firmId).eq("id",register.id).is("registration_id",null);
      register.registration_id=registration;
    }
    outcome=await matchPurchases(register,userId,{header:row-1,columns:purchaseFields.map((_,at)=>z.coerce.number().int().min(-1).max(25).parse(form.get(`column${at}`) ?? -1))});
  } catch(error) {outcome=error instanceof MatchProblem ? error.code : "read";}
  redirect(back(outcome));
}

const zero:Amounts={taxable:0,igst:0,cgst:0,sgst:0,cess:0};
const shown=(date:string)=>/^\d{4}-\d{2}-\d{2}$/.test(date) ? dueLabel(date) : date;
// The bill's amounts; where GSTR-2B has a different one, it is shown under it.
const figures=(amounts?:Amounts,portal?:Amounts)=>(["taxable","igst","cgst","sgst","cess"] as const).map((head)=><td key={head} className="num">{amounts ? rupees(amounts[head]) : ""}{portal && !agrees({...zero,[head]:amounts?.[head] ?? 0},{...zero,[head]:portal[head]}) && <span className="hint"><br/>GSTR-2B {rupees(portal[head])}</span>}</td>);
const about=(entry:Entry)=>[entry.name,entry.note && (entry.note==="C" ? "Credit note" : "Debit note"),(entry.rows?.length ?? 0)>1 && `On rows ${entry.rows!.join(", ")} of the register`,entry.times && `${entry.times} times in GSTR-2B`].filter(Boolean).join(". ");
const sum=(entries:Entry[],side:"books"|"portal")=>{const total=totalOf(entries,side);return `taxable value ₹${rupees(total.taxable)}, tax ₹${rupees(taxOf(total))}`;};
// A change with its sign: "+100.00", "-50.00", "+₹100.00".
const signed=(paise:number,unit="")=>`${paise>0 ? "+" : paise<0 ? "-" : ""}${unit}${rupees(Math.abs(paise))}`;
// What to do about a bill or note the supplier corrected, by what the books show.
const todo=(entry:Entry)=>{
  const books=`Your books${entry.booked ? ` for ${periodName(entry.booked)}` : ""}`,kind=entry.note ? "note" : "bill",state=changeState(entry);
  return state==="done" ? `${books} show the corrected amount. Nothing to do.` : state==="old" ? `${books} still show the old amount. Update them by the change.`
    : state==="other" ? `${books} show ${sum([entry],"books")}. Change them to the corrected ${kind}.` : `Not in the books. Add the corrected ${kind}.`;
};

// GSTR-2B against the purchase register, on the client's Figures: the lists for the chosen
// register's month, and the columns to confirm when it is not matched yet or a person asks.
// The page's own search: purchases (the register), heading (its column names' row) and match (what happened).
export async function PurchaseMatch({clientId,searchParams}:{clientId:string;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const search=await searchParams,one=(key:string)=>{const value=search[key];return typeof value==="string" ? value : undefined;};
  const asked=one("purchases"),heading=one("heading"),message=one("match");
  const {supabase,membership}=await currentMember();
  if(!membership) return null;
  const {data:files}=await supabase.from("documents").select("id,firm_id,client_id,name,sha256,period_key,registration_id").eq("firm_id",membership.firmId).eq("client_id",clientId).eq("work_type","gst").eq("document_type","Purchase bills").eq("status","filed").order("period_key",{ascending:false}).order("received_at",{ascending:false}).limit(100);
  const registers=files?.filter(isRegister) ?? [];
  if(!registers.length) return null;
  const register=registers.find((file)=>file.id===asked) ?? registers[0],month=periodName(register.period_key);
  const [{data:match},statement]=await Promise.all([
    supabase.from("gst_matches").select("statement_id,counts,result_enc").eq("firm_id",membership.firmId).eq("register_id",register.id).maybeSingle(),
    statementFor(register),
  ]);
  const current=!!match && match.statement_id===statement?.id,result=current ? await openMatch(membership.firmId,register.id,match.result_enc) : null;
  const canCheck=!membership.viewOnlyUntil && membership.may("check_figures",clientId);
  // The register is read to show its columns only once a person chose it.
  const choosing=canCheck && asked===register.id && (!current || !!heading);
  let rows:string[][]=[],issue="";
  if(choosing) {try {rows=await workerSheet(membership.firmId,register);} catch {issue=problems.read;}}
  const saved=rows.length ? (await savedPurchaseMappings(membership.firmId,clientId)).filter((map)=>sameHeadings(rows[map.header] ?? [],map.headings)) : [];
  const header=Number(/^\d{1,2}$/.test(heading ?? "") ? heading : (saved[0]?.header ?? 0)+1),headings=Number.isInteger(header) && header>=1 && header<=40 ? rows[header-1] ?? [] : [];
  const columns=saved.find((map)=>map.header===header-1)?.columns ?? suggestColumns(headings);
  const {data:gstins}=choosing && !register.registration_id ? await supabase.from("client_registrations").select("id,number_enc").eq("firm_id",membership.firmId).eq("client_id",clientId).eq("kind","gstin") : {data:null};
  const choices=(gstins?.length ?? 0)>1 ? await Promise.all(gstins!.map(async (reg)=>({id:reg.id,number:await serverCrypto().decrypt(membership.firmId,`clients/${clientId}/gstin`,reg.number_enc)}))) : [];
  const lists:[string,string,Entry[]][]=result ? [["missing","Not in GSTR-2B: ask the supplier",result.missing],["differ","Amounts that differ",result.differ],["extra","In GSTR-2B but not in the books",result.extra],["matched","Matched",result.matched]] : [];
  const here=`?tab=extraction&purchases=${register.id}`,note=problem(message),changes=result ? changeTotal(result.changed) : zero,unknown=result?.changed.filter((entry)=>!changeOf(entry)).length ?? 0,gap=result && changeGap(result);
  return <section className="section" id="gst-match" aria-labelledby="gst-match-title"><h2 id="gst-match-title">GSTR-2B and the purchase register</h2>
    <p className="hint">InboxCA matches each bill in the client&apos;s purchase register with the month&apos;s GSTR-2B, by the supplier&apos;s GSTIN and the invoice number, and lists every amount that differs by more than ₹1. Bills and notes the supplier corrected are listed with the change they make this month. You decide what to claim. No GSTR-3B figure is changed.</p>
    {registers.length>1 && <nav className="pills" aria-label="Purchase registers">{registers.map((file)=><Link href={`?tab=extraction&purchases=${file.id}#gst-match`} key={file.id} aria-current={register.id===file.id ? "page" : undefined}>{file.name}</Link>)}</nav>}
    {(issue || note) && <p className="alert" role="alert">{issue || note}</p>}
    {message==="matched" && current && <p className="ok" role="status">Matched with the GSTR-2B for {month}.</p>}
    {message==="no_statement" && <p className="hint" role="status">Columns saved. InboxCA matches this register as soon as the GSTR-2B for {month} is added.</p>}
    {result && match ? <>
      <p><strong>{month}: {matchLine(match.counts as unknown as Counts)}</strong></p>
      {result.skipped>0 && <p className="hint">{result.skipped} {result.skipped===1 ? "row has" : "rows have"} no supplier GSTIN or invoice number and {result.skipped===1 ? "was" : "were"} left out.</p>}
      {gap && <p className="hint">GSTR-2B&apos;s own total for corrected bills is {signed(gap.official,"₹")}; the bills listed add to {signed(gap.listed,"₹")}. Check the bills not found in earlier GSTR-2B.</p>}
      <div className="form-row">{membership.may("download",clientId) && <a className="b b-secondary b-small" href={`/app/clients/${clientId}/gst-match?register=${register.id}`}>Download the list</a>}{canCheck && !choosing && <Link className="b b-ghost b-small" href={`${here}&heading=columns#gst-match`}>Change columns</Link>}</div>
      <div className="help-list">{lists.filter(([,,entries])=>entries.length).map(([key,title,entries])=><details key={key}>
        <summary>{title}<span className="hint">{entries.length} {entries.length===1 ? "bill" : "bills"}, {key==="extra" ? sum(entries,"portal") : key==="differ" ? `in the books ${sum(entries,"books")}; in GSTR-2B ${sum(entries,"portal")}` : sum(entries,"books")}</span></summary>
        <div className="table-wrap"><table className="t"><thead><tr><th scope="col">Supplier GSTIN</th><th scope="col">Invoice</th><th scope="col">Date</th><th scope="col">Taxable value</th><th scope="col">IGST</th><th scope="col">CGST</th><th scope="col">SGST</th><th scope="col">Cess</th></tr></thead>
          <tbody>{entries.slice(0,100).map((entry,at)=><tr key={at}><td>{entry.gstin}{about(entry) && <span className="hint"><br/>{about(entry)}</span>}</td><td>{entry.number}</td><td>{shown(entry.date)}</td>{figures(key==="extra" ? entry.portal : entry.books,key==="differ" ? entry.portal : undefined)}</tr>)}</tbody></table></div>
        {entries.length>100 && <p className="hint">The first 100 are shown. Download the list for all {entries.length}.</p>}
      </details>)}
      {result.changed.length>0 && <details>
        <summary>Corrected by the supplier<span className="hint">{result.changed.length} {result.changed.length===1 ? "bill or note" : "bills and notes"}, change this month: taxable value {signed(changes.taxable,"₹")}, tax {signed(taxOf(changes),"₹")}{unknown>0 && `; ${unknown} not counted until the GSTR-2B with the original is added`}</span></summary>
        <p className="hint">Each amount is what the correction changes this month: the corrected one less the original, with a credit note below zero.</p>
        <div className="table-wrap"><table className="t"><thead><tr><th scope="col">Supplier GSTIN</th><th scope="col">Original</th><th scope="col">Corrected</th><th scope="col">Taxable value</th><th scope="col">IGST</th><th scope="col">CGST</th><th scope="col">SGST</th><th scope="col">Cess</th><th scope="col">Your books</th></tr></thead>
          <tbody>{result.changed.slice(0,100).map((entry,at)=>{const change=changeOf(entry);return <tr key={at}><td>{entry.gstin}{about(entry) && <span className="hint"><br/>{about(entry)}</span>}</td>
            <td>{entry.was?.number}<span className="hint"><br/>{shown(entry.was?.date ?? "")}<br/>{entry.was?.period ? `GSTR-2B ${periodName(entry.was.period)}` : "No earlier GSTR-2B"}</span></td>
            <td>{entry.number}<span className="hint"><br/>{shown(entry.date)}</span></td>
            {(["taxable","igst","cgst","sgst","cess"] as const).map((head)=><td key={head} className="num">{change && signed(change[head])}<span className="hint">{change && <br/>}Now {rupees(entry.portal?.[head] ?? 0)}</span></td>)}
            <td className="clients-next">{todo(entry)}</td></tr>;})}</tbody></table></div>
        {result.changed.length>100 && <p className="hint">The first 100 are shown. Download the list for all {result.changed.length}.</p>}
      </details>}</div>
    </> : !choosing && <p className="hint">{match ? "Matched with an earlier GSTR-2B. Match it again with the current one." : statement ? "Not matched with GSTR-2B yet." : `Add the GSTR-2B for ${month || "this month"} to match this register.`}{canCheck && <> <Link href={`${here}#gst-match`}>Choose columns</Link></>}</p>}
    {choosing && rows.length>0 && <>
      <Form action={`/app/clients/${clientId}`} className="form-row" key={header}><input type="hidden" name="tab" value="extraction"/><input type="hidden" name="purchases" value={register.id}/><label>Column names are on row<input type="number" name="heading" min={1} max={40} defaultValue={header}/></label><button className="b b-secondary">Show columns</button></Form>
      <form action={matchRegister} className="fields" key={header}><input type="hidden" name="client" value={clientId}/><input type="hidden" name="register" value={register.id}/><input type="hidden" name="header" value={header}/>
        {!!choices.length && <label>GSTIN this register is for<select name="registration" required defaultValue=""><option value="" disabled>Choose</option>{choices.map((reg)=><option key={reg.id} value={reg.id}>{reg.number}</option>)}</select></label>}
        {purchaseFields.map((name,at)=><label key={name}>{name}<select name={`column${at}`} defaultValue={columns[at] ?? -1}><option value={-1}>Not in this file</option>{headings.map((value,n)=><option key={n} value={n}>{String.fromCharCode(65+n)}: {value.slice(0,200)}</option>)}</select></label>)}
        <Pending className="b b-primary">Confirm columns and match</Pending></form>
    </>}
  </section>;
}
