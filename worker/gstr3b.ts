import type {Figure} from "../src/lib/datasets.ts";
import {isGstin} from "../src/lib/identifiers.ts";
import {chooseTemplate,type Template} from "../src/lib/templates.ts";
import {officialSchema} from "./schema.ts";
import {amends} from "../src/lib/gstr1-fields.ts";

// GSTR-3B from confirmed figures only, as the GST portal's GSTR-3B FAQ maps them
// (tutorial.gst.gov.in/userguide/returns/GSTR3B.htm): 3.1(a), (b), (c), (e) and 3.2 from the
// GSTIN's GSTR-1 tables (4A, 5 and 7 with or without an e-commerce operator), 3.1.1(ii) from table
// 14(b), 4(A)(1), (3), (4), (5) and 4(D)(2) from its GSTR-2B. Table 14(a) feeds no GSTR-3B table.
// Amendments count by their difference from the original, which this month's figures do not hold,
// and table 15 is the operator's own; both go to the portal. The layout is the
// JSON the official GSTR-3B offline utility writes for "Prepare Offline" upload, checked against
// GSTN's save schema. Anything the FAQ maps from elsewhere, or that needs a person's judgement,
// stops here so it is prepared on the portal instead.
type Tax={txval:number;iamt:number;camt:number;samt:number;csamt:number};
const empty=():Tax=>({txval:0,iamt:0,camt:0,samt:0,csamt:0});
const money=(value:number)=>Math.round(value*100)/100;

export function gstr3bJson(template:Template,period:string,gstin:string,registration:string,drafts:Map<string,Figure>[]) {
  chooseTemplate([template],"GSTR3B",period);
  if(!isGstin(gstin) || !template.mappings.validator) throw new Error("Check the client's GST number and official form");
  const {validate}=officialSchema(template.mappings.validator.file,template.mappings.validator.sha256);
  const home=gstin.slice(0,2),taxable=empty(),zero=empty(),nil=empty(),nonGst=empty(),registered={txval:0},unregistered=new Map<string,{txval:number;iamt:number}>();
  // Advances stopped flowing into 3.2 from the October 2025 tax period (GSTR-3B FAQ).
  const advancesIn32=period<"2025-10";
  const add=(into:Tax,txval:number,rate:number,pos:string,share:number,cess:number,sign:number,igstOnly=false)=>{
    const tax=txval*rate/100*share,inter=igstOnly || pos!==home;
    into.txval=money(into.txval+sign*txval);into.csamt=money(into.csamt+sign*cess);
    if(inter) into.iamt=money(into.iamt+sign*money(tax));
    else {into.camt=money(into.camt+sign*money(tax/2));into.samt=money(into.samt+sign*money(tax/2));}
    return inter ? money(tax) : 0;
  };
  const toUnregistered=(pos:string,txval:number,iamt:number,sign:number)=>{
    const entry=unregistered.get(pos) ?? {txval:0,iamt:0};
    unregistered.set(pos,{txval:money(entry.txval+sign*txval),iamt:money(entry.iamt+sign*iamt)});
  };
  const credit={IMPG:empty(),ISRC:empty(),ISD:empty(),OTH:empty()},ineligible=empty(),key=registration.replaceAll("-","");
  for(const draft of drafts) {
    const rows=new Map<string,Map<number,string>>();
    for(const [field,figure] of draft) {
      // GSTR-2B: only this GSTIN's statement totals, by the FAQ's table.
      const credited=new RegExp(`^gstr2b\\.${key}\\.data\\.itcsumm\\.(itcavl|itcunavl|itcrev|itcrejected)\\.([a-z]+)\\.(igst|cgst|sgst|cess)$`).exec(field);
      if(credited) {
        const [,part,section,tax]=credited,amount=Number(figure.value),slot=({igst:"iamt",cgst:"camt",sgst:"samt",cess:"csamt"} as const)[tax as "igst"];
        const into=part==="itcavl" ? ({imports:credit.IMPG,revsup:credit.ISRC,isdsup:credit.ISD,nonrevsup:credit.OTH} as Record<string,Tax>)[section] : part==="itcunavl" && ["nonrevsup","isdsup","revsup"].includes(section) ? ineligible : part==="itcrejected" ? null : undefined;
        if(into===undefined && amount) throw new Error("This GSTR-2B has credit InboxCA does not place yet. Prepare GSTR-3B on the portal.");
        if(into) into[slot]=money(into[slot]+amount);
        continue;
      }
      if(field.startsWith("gstr2b.")) continue;
      const match=/^([a-z0-9_]+)\.r(\d+)\.c(\d+)$/.exec(field);
      if(!match) continue;
      const id=`${match[1]}.${match[2]}`;if(!rows.has(id)) rows.set(id,new Map());rows.get(id)!.set(Number(match[3]),figure.value);
    }
    for(const [id,row] of rows) {
      const section=id.split(".")[0],get=(column:number)=>row.get(column) ?? "",num=(column:number)=>Number(get(column) || 0);
      const pos=(column:number)=>get(column).slice(0,2),share=(column:number)=>get(column) ? Number(get(column))/100 : 1;
      if(["b2b","cdnr"].includes(section) && get(6)==="Y") throw new Error("Reverse charge sales are in this month. Prepare GSTR-3B on the portal.");
      if(Object.hasOwn(amends,section)) throw new Error("Amendments of earlier months are in this month. Prepare GSTR-3B on the portal.");
      if(/^eco.+/.test(section)) throw new Error("Supplies an e-commerce operator reports in table 15 are in this month. Prepare GSTR-3B on the portal.");
      if(section==="eco") {
        if(get(0)==="Liable to pay tax u/s 9(5)") registered.txval=money(registered.txval+num(3));
      } else if(section==="b2b" || section==="cdnr") {
        const note=section==="cdnr",type=get(note ? 7 : 8),sign=note && get(4)==="C" ? -1 : 1,place=pos(5),rate=num(10);
        const value=num(11),cess=num(12),applicable=share(note ? 9 : 7);
        if(type.startsWith("SEZ")) add(zero,value,type==="SEZ supplies with payment" ? rate : 0,place,applicable,cess,sign,true);
        else add(taxable,value,rate,place,applicable,cess,sign,type==="Intra-State supplies attracting IGST");
      } else if(section==="b2cl") {
        const iamt=add(taxable,num(6),num(5),pos(3),share(4),num(7),1,true);
        toUnregistered(pos(3),num(6),iamt,1);
      } else if(section==="b2cs") {
        const iamt=add(taxable,num(4),num(3),pos(1),share(2),num(5),1);
        if(pos(1)!==home) toUnregistered(pos(1),num(4),iamt,1);
      } else if(section==="cdnur") {
        const sign=get(3)==="C" ? -1 : 1;
        if(get(0)==="B2CL") toUnregistered(pos(4),num(8),add(taxable,num(8),num(7),pos(4),share(6),num(9),sign,true),sign);
        else add(zero,num(8),get(0)==="EXPWP" ? num(7) : 0,"",1,num(9),sign,true);
      } else if(section==="exp") add(zero,num(8),get(0)==="WPAY" ? num(7) : 0,"",1,num(9),1,true);
      else if(section==="at" || section==="atadj") {
        const sign=section==="at" ? 1 : -1,iamt=add(taxable,num(3),num(2),pos(0),share(1),num(4),sign);
        if(advancesIn32 && pos(0)!==home) toUnregistered(pos(0),num(3),iamt,sign);
      } else if(section==="exemp") {
        nil.txval=money(nil.txval+num(1)+num(2));nonGst.txval=money(nonGst.txval+num(3));
      }
    }
  }
  // The FAQ reports positive values; a month whose notes exceed its sales goes to the portal.
  if([taxable,zero].some((part)=>part.txval<0 || part.iamt<0 || part.camt<0 || part.samt<0) || registered.txval<0 || [...unregistered.values()].some((entry)=>entry.txval<0))
    throw new Error("Credit notes or adjustments exceed this month's sales. Prepare GSTR-3B on the portal.");
  const taxes=(part:Tax)=>({iamt:part.iamt,camt:part.camt,samt:part.samt,csamt:part.csamt});
  const available=(["IMPG","IMPS","ISRC","ISD","OTH"] as const).map((ty)=>({ty,...taxes(ty==="IMPS" ? empty() : credit[ty])}));
  const net=available.reduce((total,row)=>({iamt:money(total.iamt+row.iamt),camt:money(total.camt+row.camt),samt:money(total.samt+row.samt),csamt:money(total.csamt+row.csamt)}),{iamt:0,camt:0,samt:0,csamt:0});
  const zeroes={iamt:0,camt:0,samt:0,csamt:0};
  const data={
    gstin,ret_period:period.slice(5)+period.slice(0,4),
    sup_details:{osup_det:taxable,osup_zero:{txval:zero.txval,iamt:zero.iamt,csamt:zero.csamt},osup_nil_exmp:{txval:nil.txval},isup_rev:empty(),osup_nongst:{txval:nonGst.txval}},
    eco_dtls:{eco_sup:empty(),eco_reg_sup:registered},
    inter_sup:{unreg_details:[...unregistered].filter(([,entry])=>entry.txval).map(([pos,entry])=>({pos,...entry})),comp_details:[],uin_details:[]},
    itc_elg:{itc_avl:available,itc_rev:[{ty:"RUL",...zeroes},{ty:"OTH",...zeroes}],itc_net:net,itc_inelg:[{ty:"RUL",...zeroes},{ty:"OTH",...taxes(ineligible)}]},
    inward_sup:{isup_details:[{ty:"GST",inter:0,intra:0},{ty:"NONGST",inter:0,intra:0}]},
    intr_ltfee:{intr_details:zeroes},
  };
  if(!validate(data)) throw new Error("The figures do not pass the official GSTR-3B checks");
  return Buffer.from(JSON.stringify(data));
}
