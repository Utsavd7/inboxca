import {expect,it} from "vitest";
import {fillLine,type DueFill} from "@/src/lib/return-work";

// Fill all's preview: what each return due soon gets, in the words staff read.
it("says which returns Fill all fills now and why the rest wait",()=>{
  const row=(change:Partial<DueFill>):DueFill=>({stage:"figures",open:2,missing:null,code:"GSTR1_M",period_key:"2026-09",due_on:"2026-10-29",wrong:0,ready:true,filling:false,...change});
  const today="2026-10-26";
  expect(fillLine(row({}),today)).toEqual({go:true,status:"Will be filled",what:"GSTR-1 for Sep 2026, due in 3 days. 2 figures to check"});
  expect(fillLine(row({stage:"checked",open:0,code:"GSTR3B_Q",period_key:"2026-09",due_on:today}),today)).toEqual({go:true,status:"Will be filled",what:"GSTR-3B for Jul to Sep 2026, due today. Every figure checked"});
  expect(fillLine(row({filling:true}),today)).toMatchObject({go:false,status:"Being filled"});
  expect(fillLine(row({stage:"filled",ready:false,open:1}),today)).toMatchObject({go:false,status:"Filled already",what:"GSTR-1 for Sep 2026, due in 3 days. Filled. 1 figure not checked yet"});
  expect(fillLine(row({stage:"draft",ready:false,open:0,filling:true}),today)).toMatchObject({status:"Filled already"});
  expect(fillLine(row({ready:false,wrong:1}),today)).toMatchObject({go:false,status:"Not ready",what:"GSTR-1 for Sep 2026, due in 3 days. 1 figure marked wrong"});
  expect(fillLine(row({ready:false}),today).what).toBe("GSTR-1 for Sep 2026, due in 3 days. Corrected file to check first");
  expect(fillLine(row({code:"GSTR3B_M",ready:false,missing:"credit"}),today).what).toBe("GSTR-3B for Sep 2026, due in 3 days. Papers in, GSTR-2B still missing");
  expect(fillLine(row({stage:"asked",ready:false,open:0,missing:"sales"}),today)).toMatchObject({status:"Not ready",what:"GSTR-1 for Sep 2026, due in 3 days. Papers asked for"});
});
