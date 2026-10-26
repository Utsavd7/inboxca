import {expect,it} from "vitest";
import {dueWords,fillable,fills,notReady,pinWords,returnOf,stageLine,stepOf,type Pin} from "@/src/lib/return-work";

it("names the returns InboxCA fills, and offers Fill only before a draft is made",()=>{
  expect([returnOf("GSTR1_M"),returnOf("GSTR3B_Q"),returnOf("ITR_NA"),returnOf("TDS_RET")]).toEqual(["GSTR-1","GSTR-3B","ITR",null]);
  expect([fills("GSTR1_Q"),fills("GSTR3B_M"),fills("ITR_BIZ"),fills(null)]).toEqual([true,true,false,false]);
  expect([fillable({stage:"figures",open:2,missing:null}),fillable({stage:"checked",open:0,missing:null}),fillable({stage:"figures",open:0,missing:"credit"}),fillable({stage:"filled",open:2,missing:null})]).toEqual([true,true,false,false]);
});

it("says where a return stands in one plain line",()=>{
  expect(stageLine({stage:"figures",open:3,missing:null})).toBe("Papers in, not filled yet. 3 figures not checked yet");
  expect(stageLine({stage:"figures",open:1,missing:"credit"})).toBe("Papers in, GSTR-2B still missing");
  expect(stageLine({stage:"filled",open:1,missing:null})).toBe("Filled. 1 figure not checked yet");
  expect(stageLine({stage:"asked",open:0,missing:"sales"})).toBe("Papers asked for");
  expect(stageLine({stage:"approved",open:0,missing:null})).toBe("Approved. Download it and file on the portal");
  expect(["none","asked","figures","filled","draft","approved","filed"].map(stepOf)).toEqual([0,1,2,3,4,5,6]);
});

it("refuses Fill plainly, saying what to do first",()=>{
  const work=(stage:string,missing:string|null=null)=>({stage,open:0,missing,form:null});
  expect(notReady(work("figures"),[{wrong:0,name:"Sales Sep.csv"}],"Sep 2026")).toBeNull();
  expect(notReady(work("figures"),[{wrong:2,name:"Sales Sep.csv"},{wrong:1,name:"the GSTR-2B"}],"Sep 2026")).toBe("2 figures in Sales Sep.csv and 1 figure in the GSTR-2B are marked wrong. Correct them first.");
  expect(notReady(work("none","sales"),[],"Sep 2026")).toBe("Add the sales register for Sep 2026 first.");
  expect(notReady(work("figures","credit"),[{wrong:0,name:"Sales Sep.csv"}],"Sep 2026")).toBe("Add the GSTR-2B for Sep 2026 first.");
  expect(notReady(work("filed"),[],"Sep 2026")).toBe("This return is filed already.");
  expect(notReady({...work("figures"),form:"5c0f4a52-6f0c-4a52-9d2b-1f1f1f1f1f1f"},[],"Sep 2026")).toBe("Check the figures of the corrected file first.");
});

it("words each pinned return for the person it is pinned to",()=>{
  const pin=(kind:string,stage:string,due="2026-10-30"):Pin=>({kind,stage,open:2,missing:null,task:"t",form:null,client:"c",client_name:"Invented Traders",code:"GSTR3B_M",period_key:"2026-09",due_on:due});
  expect(dueWords("2026-10-26","2026-10-26")).toBe("due today");expect(dueWords("2026-10-27","2026-10-26")).toBe("due tomorrow");
  expect(pinWords(pin("check","filled"),"2026-10-26")).toEqual({title:"GSTR-3B for Invented Traders, Sep 2026",meta:"Due in 4 days. Filled, 2 figures not checked yet"});
  expect(pinWords(pin("missing","asked"),"2026-10-26").meta).toBe("Due in 4 days. Papers still missing");
  expect(pinWords({...pin("missing","figures"),missing:"credit"},"2026-10-26").meta).toBe("Due in 4 days. GSTR-2B still missing");
  expect(pinWords(pin("fill","figures","2026-10-27"),"2026-10-26").meta).toBe("Due tomorrow. Not filled yet");
  expect(pinWords(pin("check","rejected"),"2026-10-26").meta).toBe("Due in 4 days. Draft sent back");
  expect(pinWords(pin("approve","draft"),"2026-10-26")).toEqual({title:"GSTR-3B for Invented Traders, Sep 2026",meta:"Checked and ready for your approval"});
  expect(pinWords(pin("approved","approved"),"2026-10-26").meta).toBe("Approved. Download it and file on the portal");
  expect(pinWords({...pin("fill","checked"),code:"GSTR1_Q"},"2026-10-26").title).toBe("GSTR-1 for Invented Traders, Jul to Sep 2026");
});
