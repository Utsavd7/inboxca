import {expect,it} from "vitest";
import {fillable,fills,notReady,returnOf} from "@/src/lib/return-work";

it("names the returns InboxCA fills, and offers Fill only before a draft is made",()=>{
  expect([returnOf("GSTR1_M"),returnOf("GSTR3B_Q"),returnOf("ITR_NA"),returnOf("TDS_RET")]).toEqual(["GSTR-1","GSTR-3B","ITR",null]);
  expect([fills("GSTR1_Q"),fills("GSTR3B_M"),fills("ITR_BIZ"),fills("ITR_NA"),fills("TDS_RET"),fills(null)]).toEqual([true,true,true,true,false,false]);
  expect([fillable({stage:"figures",open:2,missing:null}),fillable({stage:"checked",open:0,missing:null}),fillable({stage:"figures",open:0,missing:"credit"}),fillable({stage:"filled",open:2,missing:null})]).toEqual([true,true,false,false]);
});

it("refuses Fill plainly, saying what to do first",()=>{
  const work=(stage:string,missing:string|null=null)=>({stage,open:0,missing,form:null});
  expect(notReady(work("figures"),[{wrong:0,name:"Sales Sep.csv"}],"Sep 2026")).toBeNull();
  expect(notReady(work("figures"),[{wrong:2,name:"Sales Sep.csv"},{wrong:1,name:"the GSTR-2B"}],"Sep 2026")).toBe("2 figures in Sales Sep.csv and 1 figure in the GSTR-2B are marked wrong. Correct them first.");
  expect(notReady(work("none","sales"),[],"Sep 2026")).toBe("Add the sales register for Sep 2026 first.");
  expect(notReady(work("figures","credit"),[{wrong:0,name:"Sales Sep.csv"}],"Sep 2026")).toBe("Add the GSTR-2B for Sep 2026 first.");
  expect(notReady(work("filed"),[],"Sep 2026")).toBe("This return is filed already.");
  expect(notReady({...work("figures"),form:"5c0f4a52-6f0c-4a52-9d2b-1f1f1f1f1f1f"},[],"Sep 2026")).toBe("Check the figures of the corrected file first.");
  // An ITR with papers but no form chosen on its own page yet.
  expect(notReady(work("figures","return"),[{wrong:0,name:"Form 16.pdf"}],"FY 2025-26")).toBe("Start this return on its income tax page first, so InboxCA knows its form.");
  expect(notReady(work("checked"),[{wrong:1,name:"your team's entries"}],"FY 2025-26")).toBe("1 figure in your team's entries is marked wrong. Correct it first.");
});
