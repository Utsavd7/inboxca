import {expect,it} from "vitest";
import catalog from "../../reference/official/templates.json";
import {templateSchema} from "@/src/lib/templates";
import type {Figure} from "@/src/lib/datasets";
import {gstr3bJson} from "../../worker/gstr3b";
import {inventedGstin} from "../fixtures/portal";

// The supplier is in Gujarat (24). Rows are GSTR-1 register rows; credit is GSTR-2B totals.
const template=templateSchema.parse(catalog.find(row=>row.form_code==="GSTR3B"));
const registration="00000000-0000-4000-8000-0000000003b0",other="00000000-0000-4000-8000-0000000003b1";
const figures=(rows:[string,string[]][],credit:[string,string][]=[])=>new Map<string,Figure>([
  ...rows.flatMap(([section,values],row)=>values.flatMap((value,column)=>value==="" ? [] : [[`${section}.r${row+5}.c${column}`,{label:"Invented",value}] as [string,Figure]])),
  ...credit.map(([path,value])=>[path,{label:"Invented credit",value}] as [string,Figure]),
]);
const day="2026-09-10",gstin=inventedGstin();
const buyer=inventedGstin("ZZZPZ0002Z"),operator=inventedGstin("ZZZPZ0003Z");

it("places checked GSTR-1 sales and this GSTIN's GSTR-2B credit in the official GSTR-3B tables",()=>{
  const key=registration.replaceAll("-",""),elsewhere=other.replaceAll("-","");
  const draft=figures([
    ["b2b",[buyer,"Invented Buyer","INV/1",day,"118000","24-Gujarat","N","","Regular B2B","","18","100000","0"]],
    ["b2b",[buyer,"Invented Buyer","INV/2",day,"50000","27-Maharashtra","N","","SEZ supplies with payment","","18","50000",""]],
    ["b2cl",["INV/3",day,"236000","27-Maharashtra","","18","200000","",""]],
    ["b2cs",["OE","27-Maharashtra","","18","10000",""]],
    ["b2cs",["OE","24-Gujarat","","12","5000",""]],
    ["cdnr",[buyer,"Invented Buyer","CN/1",day,"C","24-Gujarat","N","Regular B2B","11800","","18","10000",""]],
    ["exp",["WOPAY","EXP/1",day,"80000","","","","0","80000",""]],
    ["exemp",["Intra-State supplies to unregistered persons","1200","300","450"]],
  ],[
    [`gstr2b.${key}.data.itcsumm.itcavl.nonrevsup.igst`,"5000"],[`gstr2b.${key}.data.itcsumm.itcavl.nonrevsup.cgst`,"2200"],[`gstr2b.${key}.data.itcsumm.itcavl.nonrevsup.sgst`,"2200"],
    [`gstr2b.${key}.data.itcsumm.itcavl.nonrevsup.b2b.igst`,"5000"],[`gstr2b.${key}.data.itcsumm.itcunavl.nonrevsup.cgst`,"90"],
    [`gstr2b.${elsewhere}.data.itcsumm.itcavl.nonrevsup.igst`,"99999"],
  ]);
  const json=JSON.parse(gstr3bJson(template,"2026-09",gstin,registration,[draft]).toString());
  expect(json.ret_period).toBe("092026");
  // 3.1(a): 100000 intra + 200000 B2CL + 10000 and 5000 B2CS - 10000 credit note.
  expect(json.sup_details.osup_det).toEqual({txval:305000,iamt:37800,camt:8400,samt:8400,csamt:0});
  expect(json.sup_details.osup_zero).toEqual({txval:130000,iamt:9000,csamt:0});
  expect(json.sup_details.osup_nil_exmp).toEqual({txval:1500});
  expect(json.sup_details.osup_nongst).toEqual({txval:450});
  expect(json.inter_sup.unreg_details).toEqual([{pos:"27",txval:210000,iamt:37800}]);
  expect(json.itc_elg.itc_avl.find((row:{ty:string})=>row.ty==="OTH")).toEqual({ty:"OTH",iamt:5000,camt:2200,samt:2200,csamt:0});
  expect(json.itc_elg.itc_net).toEqual({iamt:5000,camt:2200,samt:2200,csamt:0});
  expect(json.itc_elg.itc_inelg[1]).toEqual({ty:"OTH",iamt:0,camt:90,samt:0,csamt:0});
});

// GSTR-3B FAQ: 4A, 5 and 7 go to 3.1(a) whether or not an operator is named; 14(b) to 3.1.1(ii).
it("places sales through e-commerce operators in 3.1 and table 14(b) in 3.1.1(ii)",()=>{
  const draft=figures([
    ["b2b",[buyer,"Invented Buyer","INV/1",day,"118000","24-Gujarat","N","","Regular B2B",operator,"18","100000",""]],
    ["b2cs",["E","27-Maharashtra","","18","10000","",operator]],
    ["eco",["Liable to pay tax u/s 9(5)",operator,"Invented Operator","25000","0","0","0",""]],
    ["eco",["Liable to collect tax u/s 52(TCS)",operator,"Invented Operator","110000","1800","9000","9000",""]],
  ]);
  const json=JSON.parse(gstr3bJson(template,"2026-09",gstin,registration,[draft]).toString());
  expect(json.sup_details.osup_det).toEqual({txval:110000,iamt:1800,camt:9000,samt:9000,csamt:0});
  expect(json.eco_dtls).toEqual({eco_sup:{txval:0,iamt:0,camt:0,samt:0,csamt:0},eco_reg_sup:{txval:25000}});
  expect(json.inter_sup.unreg_details).toEqual([{pos:"27",txval:10000,iamt:1800}]);
});

it("sends months it cannot fill faithfully to the portal",()=>{
  const sale=(changes:Record<number,string>)=>{const row=[buyer,"Invented Buyer","INV/1",day,"118000","24-Gujarat","N","","Regular B2B","","18","100000",""];for(const [at,value] of Object.entries(changes)) row[Number(at)]=value;return figures([["b2b",row]]);};
  expect(()=>gstr3bJson(template,"2026-09",gstin,registration,[sale({6:"Y"})])).toThrow("Reverse charge");
  expect(()=>gstr3bJson(template,"2026-09",gstin,registration,[figures([["b2csa",["2025-26","MARCH","27-Maharashtra","OE","","18","10000","",""]]])])).toThrow("Amendments");
  expect(()=>gstr3bJson(template,"2026-09",gstin,registration,[figures([["ecoa",["Liable to pay tax u/s 9(5)","2025-26","MARCH",operator,operator,"","1000","0","0","0",""]]])])).toThrow("Amendments");
  expect(()=>gstr3bJson(template,"2026-09",gstin,registration,[figures([["ecourp2c",["24-Gujarat","1000","5",""]]])])).toThrow("table 15");
  expect(()=>gstr3bJson(template,"2026-09",gstin,registration,[figures([["eco",["Liable to pay tax u/s 9(5)",operator,"","-500","0","0","0",""]]])])).toThrow("exceed");
  expect(()=>gstr3bJson(template,"2026-09",gstin,registration,[figures([["cdnr",[buyer,"Invented Buyer","CN/1",day,"C","24-Gujarat","N","Regular B2B","11800","","18","10000",""]]])])).toThrow("exceed");
  expect(()=>gstr3bJson(template,"2026-09",gstin,registration,[figures([],[[`gstr2b.${registration.replaceAll("-","")}.data.itcsumm.itcrev.nonrevsup.igst`,"10"]])])).toThrow("portal");
  expect(()=>gstr3bJson(template,"2025-03",gstin,registration,[sale({})])).toThrow();
});

it("puts inter-State advances in 3.2 only before October 2025",()=>{
  const advance=figures([["at",["27-Maharashtra","","18","10000",""]]]);
  expect(JSON.parse(gstr3bJson(template,"2025-09",gstin,registration,[advance]).toString()).inter_sup.unreg_details).toEqual([{pos:"27",txval:10000,iamt:1800}]);
  expect(JSON.parse(gstr3bJson(template,"2025-10",gstin,registration,[advance]).toString()).inter_sup.unreg_details).toEqual([]);
});
