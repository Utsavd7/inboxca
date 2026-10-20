import {afterEach,beforeEach,expect,it,vi} from "vitest";
import type {Job} from "@/src/jobs/runner";
const mock=vi.hoisted(()=>({send:vi.fn(),found:vi.fn(),details:{} as Record<string,unknown>,filed:false,data:false,sent:0}));
vi.mock("@/src/lib/firm-mail",()=>({firmMailer:async()=>({send:mock.send,sentAlready:mock.found})}));
vi.mock("@/src/lib/crypto",()=>({serverCrypto:()=>({decrypt:async()=>"client@invented.test"})}));
vi.mock("@/src/lib/supabase",()=>({supabaseAdmin:()=>({from:(table:string)=>({
  columns:"",write:false,
  select(columns:string){this.columns=columns;return this;},eq(){return this;},is(){return this;},gte(){return this;},lte(){return this;},in(){return this;},neq(){return this;},gt(){return this;},
  update(value:{details?:Record<string,unknown>}){if(table==="tasks")mock.details=value.details ?? {};this.write=true;return this;},
  insert(){this.write=true;return this;},
  async maybeSingle(){return {data:{name:"Invented Firm",settings:{reminders:true}}};},
  then(resolve:(value:unknown)=>void){resolve({error:null,count:mock.sent,data:this.write ? null : table==="tasks" ? mock.filed ? [] : [{id:"task",client_id:"client",code:"GSTR3B_M",period_key:"2026-09",due_on:"2026-10-20",details:mock.details,clients:{name:"Invented Client",email_enc:"encrypted test email",reminders_paused:false}}] : table==="compliance_types" ? [{code:"GSTR3B_M",name:"GSTR-3B",frequency:"monthly",verified_on:"2026-01-01"}] : table==="documents" && mock.data ? [{client_id:"client",work_type:"gst",period_key:"2026-09"}] : []});},
})})}));
import {sendReminders} from "@/src/jobs/reminders";
const job={entity_id:"firm"} as Job;
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-17T05:00:00Z"));vi.clearAllMocks();mock.details={reminder:{day:"2026-10-17",state:"sending"}};mock.filed=false;mock.data=false;mock.sent=0;mock.found.mockResolvedValue(true);mock.send.mockResolvedValue(true);});
afterEach(()=>vi.useRealTimers());
// M5 acceptance: the reminder sender reconciles a possible send, not just the job lease.
it("finds a reminder in Sent after a crash and never sends a duplicate",async()=>{
  await sendReminders(job,{markSending:async()=>{}});
  await sendReminders(job,{markSending:async()=>{}});
  expect(mock.found).toHaveBeenCalledOnce();
  expect(mock.send).not.toHaveBeenCalled();
  expect(mock.details.reminder).toEqual({day:"2026-10-17",state:"sent"});
});
// M5 acceptance: data already received for the month means no reminder.
it("skips filed work, received data and new work added after today's email",async()=>{
  mock.filed=true;
  await sendReminders(job,{markSending:async()=>{}});
  mock.filed=false;mock.data=true;
  await sendReminders(job,{markSending:async()=>{}});
  expect(mock.details.skipped).toEqual({day:"2026-10-17",reason:"data_received"});
  mock.data=false;mock.details={};mock.sent=1;
  await sendReminders(job,{markSending:async()=>{}});
  expect(mock.send).not.toHaveBeenCalled();
});
