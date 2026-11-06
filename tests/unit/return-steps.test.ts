import {expect,it} from "vitest";
import {currentStep,nextAction,stepsFor} from "@/src/lib/return-steps";

const work=(stage:string,open=0,missing:string|null=null)=>({stage,open,missing,form:null});
const ready={period:"Sep 2026",drafts:[{wrong:0,name:"Sales Sep.csv"}],approver:true};

it("gives each return only the steps that apply to it",()=>{
  const all=["papers","figures","draft","check","approve","file"];
  expect([stepsFor("GSTR1_M"),stepsFor("GSTR3B_M"),stepsFor("GSTR1_Q"),stepsFor("ITR_NA")]).toEqual([all,all,all,all]);
  // A TDS statement is prepared but never filled, so there is no fill to check.
  expect(stepsFor("TDS_RET")).toEqual(["papers","figures","draft","approve","file"]);
  expect([stepsFor("DIR3KYC"),stepsFor("GSTR9"),stepsFor(null)]).toEqual([["papers","file"],["papers","file"],["papers","file"]]);
});

it("opens the step a return stands at, skipping the ones it does not have",()=>{
  const at=(stage:string,code="GSTR1_M",missing:string|null=null)=>currentStep(work(stage,0,missing),code);
  expect(["none","asked","in","figures","checked","filled","rejected","draft","approved","filed"].map(stage=>at(stage)))
    .toEqual(["papers","papers","figures","draft","draft","check","check","approve","file","file"]);
  expect([at("figures","GSTR1_M","sales"),at("figures","GSTR3B_M","credit"),at("figures","ITR_NA","return")]).toEqual(["figures","figures","draft"]);
  // A file corrected outside InboxCA has its figures checked first.
  expect(currentStep({...work("figures"),form:"5c0f4a52-6f0c-4a52-9d2b-1f1f1f1f1f1f"},"GSTR1_M")).toBe("figures");
  expect([at("none","DIR3KYC"),at("in","DIR3KYC"),at("filed","DIR3KYC")]).toEqual(["papers","file","file"]);
});

it("names one next action, or why the return waits",()=>{
  expect(nextAction(work("none"),"GSTR1_M",ready)).toMatchObject({step:"papers",act:"ask",label:"Ask for papers"});
  expect(nextAction(work("asked"),"GSTR1_M",ready)).toMatchObject({step:"papers",act:"upload"});
  expect(nextAction(work("figures",2),"GSTR1_M",ready)).toMatchObject({step:"draft",act:"fill",label:"Prepare GSTR-1"});
  expect(nextAction(work("checked"),"GSTR3B_M",ready)).toMatchObject({step:"draft",act:"fill",label:"Prepare GSTR-3B"});
  // When Fill would refuse, its reason, and no button that cannot work.
  expect(nextAction(work("in",0,"sales"),"GSTR1_M",{...ready,drafts:[]})).toEqual({step:"figures",why:"Add the sales register for Sep 2026 first."});
  expect(nextAction(work("figures"),"GSTR1_M",{...ready,drafts:[{wrong:1,name:"Sales Sep.csv"}]})).toEqual({step:"figures",why:"1 figure in Sales Sep.csv is marked wrong. Correct it first."});
  expect(nextAction(work("filled",3),"GSTR1_M",ready)).toMatchObject({step:"check",act:"check",label:"Check 3 figures"});
  expect(nextAction(work("draft"),"GSTR1_M",ready)).toMatchObject({step:"approve",act:"approve",label:"Approve"});
  // Someone who may not approve sees it wait, and why.
  const waiting=nextAction(work("draft"),"GSTR1_M",{...ready,approver:false});
  expect(waiting).toMatchObject({step:"approve"});expect(waiting?.act).toBeUndefined();expect(waiting?.why).toBeTruthy();
  expect(nextAction(work("approved"),"GSTR1_M",ready)).toMatchObject({step:"file",act:"download",label:"Download and file"});
  expect(nextAction(work("filed"),"GSTR1_M",ready)).toBeNull();
});

it("sends ITR and TDS drafts to their own pages for now, and a return InboxCA does not prepare to filing",()=>{
  expect(nextAction(work("figures",0,"return"),"ITR_NA",ready)).toMatchObject({step:"draft",act:"open"});
  expect(nextAction(work("checked"),"ITR_NA",ready)).toMatchObject({step:"draft",act:"open"});
  expect(nextAction(work("in"),"TDS_RET",{...ready,drafts:[]})).toMatchObject({step:"draft",act:"open"});
  expect(nextAction(work("in"),"DIR3KYC",ready)).toMatchObject({step:"file",act:"file"});
  expect(nextAction(work("none"),"DIR3KYC",ready)).toMatchObject({step:"papers",act:"ask"});
});
